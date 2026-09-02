package com.grok2api.creativeworkbench;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.graphics.Insets;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsAnimationCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.core.view.ViewCompat;

import java.util.List;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    public MainActivity() {
        registerPlugin(SecureStorePlugin.class);
        registerPlugin(NativeHttpPlugin.class);
        registerPlugin(MediaStorePlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        super.onCreate(savedInstanceState);

        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        window.setStatusBarColor(Color.BLACK);
        window.setNavigationBarColor(Color.BLACK);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) window.setNavigationBarContrastEnforced(false);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
        installAnimatedInsets();
    }

    private void installAnimatedInsets() {
        View webView = findViewById(com.getcapacitor.android.R.id.webview);
        if (webView == null || !(webView.getParent() instanceof ViewGroup host)) return;

        final int initialLeft = host.getPaddingLeft();
        final int initialTop = host.getPaddingTop();
        final int initialRight = host.getPaddingRight();
        final int initialBottom = host.getPaddingBottom();
        host.setBackgroundColor(Color.BLACK);
        host.setClipToPadding(true);
        ViewCompat.setOnApplyWindowInsetsListener(host, (view, insets) -> {
            applyInsets(view, insets, initialLeft, initialTop, initialRight, initialBottom);
            // The host owns the system-bar and IME boundary; do not let a
            // second native listener add another margin to the WebView.
            return WindowInsetsCompat.CONSUMED;
        });
        View animationHost = getWindow().getDecorView();
        ViewCompat.setWindowInsetsAnimationCallback(animationHost, new WindowInsetsAnimationCompat.Callback(
            WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE
        ) {
            @Override
            public WindowInsetsCompat onProgress(WindowInsetsCompat insets, List<WindowInsetsAnimationCompat> runningAnimations) {
                applyInsets(host, insets, initialLeft, initialTop, initialRight, initialBottom);
                return insets;
            }
        });
        ViewCompat.requestApplyInsets(host);
        ViewCompat.requestApplyInsets(animationHost);
    }

    private static void applyInsets(
        View host,
        WindowInsetsCompat insets,
        int initialLeft,
        int initialTop,
        int initialRight,
        int initialBottom
    ) {
        Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
        Insets gestures = insets.getInsets(WindowInsetsCompat.Type.systemGestures());
        int bottom = Math.max(Math.max(bars.bottom, ime.bottom), gestures.bottom);
        host.setPadding(
            initialLeft + bars.left,
            initialTop + bars.top,
            initialRight + bars.right,
            initialBottom + bottom
        );
    }
}
