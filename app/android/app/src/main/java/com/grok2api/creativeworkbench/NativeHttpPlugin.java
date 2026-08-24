package com.grok2api.creativeworkbench;

import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.io.DataOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.GZIPInputStream;

/** CORS-free, cancellable HTTP transport with true incremental SSE delivery. */
@CapacitorPlugin(name = "NativeHttp")
public class NativeHttpPlugin extends Plugin {
    private static final int MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Map<String, HttpURLConnection> activeConnections = new ConcurrentHashMap<>();

    @PluginMethod
    public void request(PluginCall call) {
        execute(call, false);
    }

    @PluginMethod
    public void stream(PluginCall call) {
        execute(call, true);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String requestId = call.getString("requestId", "");
        HttpURLConnection connection = activeConnections.remove(requestId);
        if (connection != null) connection.disconnect();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        for (HttpURLConnection connection : activeConnections.values()) connection.disconnect();
        activeConnections.clear();
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private void execute(PluginCall call, boolean streaming) {
        String requestId = call.getString("requestId", "");
        String rawUrl = call.getString("url", "");
        if (requestId.isEmpty() || rawUrl.isEmpty()) {
            call.reject("requestId and url are required");
            return;
        }
        executor.submit(() -> {
            HttpURLConnection connection = null;
            boolean started = false;
            try {
                connection = (HttpURLConnection) new URL(rawUrl).openConnection();
                activeConnections.put(requestId, connection);
                configureConnection(connection, call);
                writeBody(connection, call);
                int status = connection.getResponseCode();
                JSObject headers = responseHeaders(connection);
                if (!streaming || status < 200 || status >= 300) {
                    byte[] data = readAll(decodedStream(responseStream(connection, status), connection.getContentEncoding()));
                    JSObject result = response(status, headers, data);
                    call.resolve(result);
                    return;
                }

                call.resolve(response(status, headers, null));
                started = true;
                try (InputStream stream = decodedStream(responseStream(connection, status), connection.getContentEncoding())) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = stream.read(buffer)) >= 0) {
                        if (count == 0) continue;
                        JSObject event = new JSObject();
                        event.put("requestId", requestId);
                        event.put("data", Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP));
                        notifyListeners("streamChunk", event);
                    }
                }
                JSObject end = new JSObject();
                end.put("requestId", requestId);
                notifyListeners("streamEnd", end);
            } catch (Exception error) {
                if (started) {
                    JSObject event = new JSObject();
                    event.put("requestId", requestId);
                    event.put("message", error.getMessage() == null ? "Native stream failed" : error.getMessage());
                    notifyListeners("streamError", event);
                } else {
                    call.reject("Native request failed", error);
                }
            } finally {
                activeConnections.remove(requestId);
                if (connection != null) connection.disconnect();
            }
        });
    }

    private void configureConnection(HttpURLConnection connection, PluginCall call) throws Exception {
        connection.setRequestMethod(call.getString("method", "GET"));
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        connection.setConnectTimeout(call.getInt("connectTimeoutMs", 15_000));
        connection.setReadTimeout(call.getInt("readTimeoutMs", 300_000));
        JSObject headers = call.getObject("headers", new JSObject());
        Iterator<String> keys = headers.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            if (!key.equalsIgnoreCase("x-grok2api-body-encoding")) connection.setRequestProperty(key, headers.getString(key));
        }
    }

    private void writeBody(HttpURLConnection connection, PluginCall call) throws Exception {
        String bodyType = call.getString("bodyType", "");
        if (bodyType.isEmpty()) return;
        connection.setDoOutput(true);
        if (bodyType.equals("formData")) {
            connection.setChunkedStreamingMode(64 * 1024);
            writeFormData(connection, call.getArray("formData", new JSArray()));
            return;
        }
        String body = call.getString("body", "");
        JSObject headers = call.getObject("headers", new JSObject());
        boolean base64 = "base64".equals(headers.getString("x-grok2api-body-encoding", ""));
        byte[] bytes = base64 ? Base64.decode(body, Base64.DEFAULT) : body.getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(bytes.length);
        try (DataOutputStream output = new DataOutputStream(connection.getOutputStream())) {
            output.write(bytes);
        }
    }

    private void writeFormData(HttpURLConnection connection, JSArray entries) throws Exception {
        String boundary = "----grok2api-" + UUID.randomUUID();
        connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
        try (DataOutputStream output = new DataOutputStream(connection.getOutputStream())) {
            for (Object rawEntry : entries.toList()) {
                if (!(rawEntry instanceof JSONObject entry)) continue;
                String type = entry.optString("type");
                String key = safeToken(entry.optString("key"));
                output.writeBytes("--" + boundary + "\r\n");
                if (type.equals("base64File")) {
                    String filename = safeToken(entry.optString("fileName", "file"));
                    String contentType = entry.optString("contentType", "application/octet-stream");
                    output.writeBytes("Content-Disposition: form-data; name=\"" + key + "\"; filename=\"" + filename + "\"\r\n");
                    output.writeBytes("Content-Type: " + contentType + "\r\n\r\n");
                    output.write(Base64.decode(entry.optString("value"), Base64.DEFAULT));
                    output.writeBytes("\r\n");
                } else {
                    output.writeBytes("Content-Disposition: form-data; name=\"" + key + "\"\r\n\r\n");
                    output.write(entry.optString("value").getBytes(StandardCharsets.UTF_8));
                    output.writeBytes("\r\n");
                }
            }
            output.writeBytes("--" + boundary + "--\r\n");
        }
    }

    private InputStream responseStream(HttpURLConnection connection, int status) throws Exception {
        InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
        return stream == null ? new ByteArrayInputStream(new byte[0]) : stream;
    }

    private InputStream decodedStream(InputStream stream, String encoding) throws Exception {
        return encoding != null && encoding.equalsIgnoreCase("gzip") ? new GZIPInputStream(stream) : stream;
    }

    private byte[] readAll(InputStream source) throws Exception {
        try (InputStream stream = source; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = stream.read(buffer)) >= 0) {
                if (count <= 0) continue;
                if (output.size() + count > MAX_RESPONSE_BYTES) throw new IllegalStateException("Response exceeded 32 MiB native limit");
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    private JSObject response(int status, JSObject headers, byte[] data) {
        JSObject result = new JSObject();
        result.put("status", status);
        result.put("headers", headers);
        if (data != null && data.length > 0) result.put("data", Base64.encodeToString(data, Base64.NO_WRAP));
        return result;
    }

    private JSObject responseHeaders(HttpURLConnection connection) {
        JSObject result = new JSObject();
        for (Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) {
            if (entry.getKey() != null && entry.getValue() != null) result.put(entry.getKey(), String.join(", ", entry.getValue()));
        }
        return result;
    }

    private String safeToken(String value) {
        return value.replace("\r", "").replace("\n", "").replace("\"", "");
    }
}
