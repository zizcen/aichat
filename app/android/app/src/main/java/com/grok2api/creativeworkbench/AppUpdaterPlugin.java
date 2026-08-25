package com.grok2api.creativeworkbench;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Downloads a trusted GitHub APK and hands it to Android's package installer. */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final int MAX_REDIRECTS = 5;
    private static final long MAX_APK_BYTES = 120L * 1024L * 1024L;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url", "");
        String fileName = call.getString("fileName", "creative-workbench-update.apk");
        String expectedSha256 = call.getString("sha256", "");
        if (url.isEmpty()) {
            call.reject("更新地址为空");
            return;
        }
        executor.execute(() -> {
            try {
                DownloadedApk apk = downloadApk(url, fileName, expectedSha256);
                JSObject result = new JSObject();
                result.put("uri", apk.uri.toString());
                result.put("sha256", apk.sha256);
                result.put("size", apk.size);
                result.put("fileName", apk.file.getName());
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "更新下载失败" : error.getMessage(), error);
            }
        });
    }

    @PluginMethod
    public void install(PluginCall call) {
        String rawUri = call.getString("uri", "");
        if (rawUri.isEmpty()) {
            call.reject("安装文件地址为空");
            return;
        }
        Context context = getContext();
        if (context == null) {
            call.reject("应用上下文不可用");
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && !context.getPackageManager().canRequestPackageInstalls()) {
                Intent settings = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + context.getPackageName())
                );
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(settings);
                JSObject result = new JSObject();
                result.put("status", "permission_required");
                call.resolve(result);
                return;
            }

            Intent installer = new Intent(Intent.ACTION_VIEW);
            installer.setDataAndType(Uri.parse(rawUri), "application/vnd.android.package-archive");
            installer.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(installer);
            JSObject result = new JSObject();
            result.put("status", "started");
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法打开系统安装器", error);
        }
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private DownloadedApk downloadApk(String rawUrl, String requestedName, String expectedSha256)
            throws Exception {
        URL next = new URL(rawUrl);
        validateUrl(next);
        HttpURLConnection connection = null;
        InputStream input = null;
        File temporary = null;
        try {
            for (int redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
                connection = (HttpURLConnection) next.openConnection();
                connection.setRequestMethod("GET");
                connection.setInstanceFollowRedirects(false);
                connection.setUseCaches(false);
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(180_000);
                connection.setRequestProperty("Accept", "application/vnd.android.package-archive");
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) {
                    String location = connection.getHeaderField("Location");
                    connection.disconnect();
                    if (location == null || location.isEmpty())
                        throw new IOException("更新下载重定向地址为空");
                    next = new URL(next, location);
                    validateUrl(next);
                    continue;
                }
                if (status < 200 || status >= 300)
                    throw new IOException("更新下载失败（HTTP " + status + "）");

                long contentLength = connection.getContentLengthLong();
                if (contentLength > MAX_APK_BYTES)
                    throw new IOException("更新文件超过 120 MiB 限制");
                input = new BufferedInputStream(connection.getInputStream());
                Context context = getContext();
                if (context == null) throw new IOException("应用上下文不可用");
                File cache = context.getCacheDir();
                temporary = new File(cache, safeFileName(requestedName) + ".part");
                File target = new File(cache, safeFileName(requestedName));
                if (temporary.exists()) temporary.delete();
                if (target.exists()) target.delete();

                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long total = 0;
                byte[] buffer = new byte[64 * 1024];
                try (BufferedOutputStream output = new BufferedOutputStream(new FileOutputStream(temporary))) {
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        total += count;
                        if (total > MAX_APK_BYTES)
                            throw new IOException("更新文件超过 120 MiB 限制");
                        digest.update(buffer, 0, count);
                        output.write(buffer, 0, count);
                    }
                }
                String actualSha256 = hex(digest.digest());
                String normalizedExpected = expectedSha256.replace("sha256:", "")
                        .trim().toLowerCase(Locale.ROOT);
                if (!normalizedExpected.isEmpty() && !normalizedExpected.equals(actualSha256))
                    throw new IOException("更新文件校验失败");
                try {
                    Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING);
                } catch (Exception moveError) {
                    if (!temporary.renameTo(target)) throw moveError;
                }
                Uri uri = FileProvider.getUriForFile(
                        context,
                        context.getPackageName() + ".fileprovider",
                        target
                );
                return new DownloadedApk(target, uri, actualSha256, total);
            }
            throw new IOException("更新下载重定向次数过多");
        } finally {
            if (input != null) try { input.close(); } catch (IOException ignored) { }
            if (connection != null) connection.disconnect();
            if (temporary != null && temporary.exists()) temporary.delete();
        }
    }

    private void validateUrl(URL url) throws IOException {
        if (!"https".equalsIgnoreCase(url.getProtocol()))
            throw new IOException("更新地址必须使用 HTTPS");
        String host = url.getHost().toLowerCase(Locale.ROOT);
        if (!(host.equals("github.com") || host.endsWith(".github.com")
                || host.equals("githubusercontent.com") || host.endsWith(".githubusercontent.com")
                || host.equals("githubassets.com") || host.endsWith(".githubassets.com")))
            throw new IOException("更新地址不是受信任的 GitHub 地址");
    }

    private String safeFileName(String value) {
        String safe = value == null ? "creative-workbench-update.apk" : value
                .replaceAll("[^A-Za-z0-9._-]", "_");
        if (!safe.toLowerCase(Locale.ROOT).endsWith(".apk")) safe += ".apk";
        return safe;
    }

    private String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value));
        return result.toString();
    }

    private static final class DownloadedApk {
        final File file;
        final Uri uri;
        final String sha256;
        final long size;

        DownloadedApk(File file, Uri uri, String sha256, long size) {
            this.file = file;
            this.uri = uri;
            this.sha256 = sha256;
            this.size = size;
        }
    }
}
