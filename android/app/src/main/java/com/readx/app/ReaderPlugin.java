package com.readx.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.KeyEvent;
import android.view.WindowManager;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Reader helpers the WebView can't do itself:
 *  - keep the screen on while reading
 *  - turn pages with the volume keys (the keys are consumed only while the reader asks for them)
 *  - save an export to Downloads, or hand it to another app (share sheet)
 */
@CapacitorPlugin(name = "ReaderNative")
public class ReaderPlugin extends Plugin {
    private static ReaderPlugin instance;
    private volatile boolean volumeKeys = false;

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void setKeepAwake(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    @PluginMethod
    public void setVolumeKeys(PluginCall call) {
        volumeKeys = Boolean.TRUE.equals(call.getBoolean("on", false));
        call.resolve();
    }

    /** Write a text file to Downloads/ReadX (Android 10+; older versions use the share sheet). */
    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("name", "ReadX export.txt");
        String mime = call.getString("mime", "text/plain");
        String content = call.getString("content", "");
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.unavailable("Saving to Downloads needs Android 10 or newer. Use Share instead.");
            return;
        }
        try {
            ContentResolver resolver = getContext().getContentResolver();
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/ReadX");
            Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new Exception("Couldn't create the file");
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new Exception("Couldn't write the file");
                out.write(content.getBytes(StandardCharsets.UTF_8));
            }
            JSObject ret = new JSObject();
            ret.put("path", "Downloads/ReadX/" + name);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "Couldn't save the file", e);
        }
    }

    /** Open the system share sheet with a text file (Drive, Gmail, Notion, WhatsApp, Files…). */
    @PluginMethod
    public void shareFile(PluginCall call) {
        String name = call.getString("name", "ReadX export.txt");
        String mime = call.getString("mime", "text/plain");
        String content = call.getString("content", "");
        String title = call.getString("title", name);
        try {
            File dir = new File(getContext().getCacheDir(), "exports");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("Couldn't prepare the file");
            File file = new File(dir, name);
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(content.getBytes(StandardCharsets.UTF_8));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, title);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, title);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() != null ? e.getMessage() : "Couldn't share the file", e);
        }
    }

    /** Called by MainActivity for every key; true = handled (the volume doesn't change). */
    static boolean handleKey(KeyEvent event) {
        ReaderPlugin p = instance;
        if (p == null || !p.volumeKeys) return false;
        int code = event.getKeyCode();
        if (code != KeyEvent.KEYCODE_VOLUME_UP && code != KeyEvent.KEYCODE_VOLUME_DOWN) return false;
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            JSObject data = new JSObject();
            data.put("key", code == KeyEvent.KEYCODE_VOLUME_DOWN ? "down" : "up");
            p.notifyListeners("volumeKey", data);
        }
        return true;
    }
}
