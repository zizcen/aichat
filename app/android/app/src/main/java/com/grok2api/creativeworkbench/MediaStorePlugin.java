package com.grok2api.creativeworkbench;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

@CapacitorPlugin(
    name = "MediaStore",
    permissions = { @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "storage") }
)
public class MediaStorePlugin extends Plugin {
    @PluginMethod
    public void save(PluginCall call) {
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermissionCallback");
            return;
        }
        saveMedia(call);
    }

    @PermissionCallback
    private void storagePermissionCallback(PluginCall call) {
        if (getPermissionState("storage") != PermissionState.GRANTED) {
            call.reject("Storage permission was denied");
            return;
        }
        saveMedia(call);
    }

    private void saveMedia(PluginCall call) {
        String filename = safeFilename(call.getString("filename", "grok2api-media.bin"));
        String mimeType = call.getString("mimeType", "application/octet-stream");
        String encoded = call.getString("data", "");
        if (encoded.isEmpty()) {
            call.reject("Media data is empty");
            return;
        }
        try {
            byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
            Uri uri = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? saveScoped(filename, mimeType, bytes)
                : saveLegacy(filename, mimeType, bytes);
            JSObject result = new JSObject();
            result.put("uri", uri.toString());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to save media", error);
        }
    }

    private Uri saveScoped(String filename, String mimeType, byte[] bytes) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, filename);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath(mimeType));
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri uri = resolver.insert(collection(mimeType), values);
        if (uri == null) throw new IllegalStateException("Unable to create media entry");
        try (OutputStream output = resolver.openOutputStream(uri)) {
            if (output == null) throw new IllegalStateException("Unable to open media output");
            output.write(bytes);
        } catch (Exception error) {
            resolver.delete(uri, null, null);
            throw error;
        }
        values.clear();
        values.put(MediaStore.MediaColumns.IS_PENDING, 0);
        resolver.update(uri, values, null, null);
        return uri;
    }

    @SuppressWarnings("deprecation")
    private Uri saveLegacy(String filename, String mimeType, byte[] bytes) throws Exception {
        File directory = new File(Environment.getExternalStoragePublicDirectory(legacyDirectory(mimeType)), "Grok2API");
        if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Unable to create media directory");
        File outputFile = uniqueFile(directory, filename);
        try (FileOutputStream output = new FileOutputStream(outputFile)) { output.write(bytes); }
        MediaScannerConnection.scanFile(getContext(), new String[] { outputFile.getAbsolutePath() }, new String[] { mimeType }, null);
        return Uri.fromFile(outputFile);
    }

    private Uri collection(String mimeType) {
        if (mimeType.startsWith("image/")) return MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        if (mimeType.startsWith("video/")) return MediaStore.Video.Media.EXTERNAL_CONTENT_URI;
        if (mimeType.startsWith("audio/")) return MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
        return MediaStore.Files.getContentUri("external");
    }

    private String relativePath(String mimeType) {
        return legacyDirectory(mimeType) + File.separator + "Grok2API";
    }

    private String legacyDirectory(String mimeType) {
        if (mimeType.startsWith("image/")) return Environment.DIRECTORY_PICTURES;
        if (mimeType.startsWith("video/")) return Environment.DIRECTORY_MOVIES;
        if (mimeType.startsWith("audio/")) return Environment.DIRECTORY_MUSIC;
        return Environment.DIRECTORY_DOWNLOADS;
    }

    private File uniqueFile(File directory, String filename) {
        File candidate = new File(directory, filename);
        if (!candidate.exists()) return candidate;
        int dot = filename.lastIndexOf('.');
        String stem = dot > 0 ? filename.substring(0, dot) : filename;
        String extension = dot > 0 ? filename.substring(dot) : "";
        return new File(directory, stem + "-" + System.currentTimeMillis() + extension);
    }

    private String safeFilename(String value) {
        String sanitized = value.replaceAll("[\\\\/:*?\"<>|\\r\\n]", "-").trim();
        return sanitized.isEmpty() ? "grok2api-media.bin" : sanitized;
    }
}
