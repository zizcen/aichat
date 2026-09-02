package com.grok2api.creativeworkbench;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsAnimationCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.core.view.ViewCompat;

import java.util.List;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private ViewGroup imeHost;
    private WebView imeWebView;
    private View.OnLayoutChangeListener imeLayoutListener;
    private WindowInsetsCompat lastInsets;
    private WindowInsetsCompat appliedInsets;
    private WindowInsetsCompat deferredInsets;
    private int initialLeft;
    private int initialTop;
    private int initialRight;
    private int initialBottom;
    private int baselineHostHeight = -1;
    private int baselineHostWidth = -1;
    private int lastDispatchedIme = -1;
    private int insetInstallAttempts;
    private boolean imeAnimationRunning;
    private boolean insetsInstalled;

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
        if (insetsInstalled || isFinishing() || isDestroyed()) return;
        View webView = findViewById(com.getcapacitor.android.R.id.webview);
        if (!(webView instanceof WebView) || !(webView.getParent() instanceof ViewGroup host)) {
            // BridgeActivity creates the WebView during super.onCreate. A
            // posted retry keeps the first frame inset-safe on slow devices.
            if (insetInstallAttempts++ < 30) {
                getWindow().getDecorView().postDelayed(this::installAnimatedInsets, 32L);
            }
            return;
        }

        imeHost = host;
        imeWebView = (WebView) webView;
        initialLeft = host.getPaddingLeft();
        initialTop = host.getPaddingTop();
        initialRight = host.getPaddingRight();
        initialBottom = host.getPaddingBottom();
        baselineHostHeight = host.getHeight();
        baselineHostWidth = host.getWidth();
        insetsInstalled = true;
        host.setBackgroundColor(Color.BLACK);
        host.setFitsSystemWindows(false);
        host.setClipToPadding(true);
        ViewCompat.setOnApplyWindowInsetsListener(host, (view, insets) -> {
            lastInsets = insets;
            // WindowInsetsAnimationCompat calls onPrepare before this listener
            // receives the end state. Keep the starting layout until
            // onProgress supplies the interpolated frame; this prevents the
            // one-frame jump that was visible above the keyboard.
            if (imeAnimationRunning) {
                deferredInsets = insets;
                if (appliedInsets != null) {
                    applyInsets(host, appliedInsets, false);
                }
            } else {
                applyInsets(host, insets, false);
            }
            return WindowInsetsCompat.CONSUMED;
        });

        View animationHost = getWindow().getDecorView();
        ViewCompat.setWindowInsetsAnimationCallback(animationHost, new WindowInsetsAnimationCompat.Callback(
            WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE
        ) {
            @Override
            public void onPrepare(WindowInsetsAnimationCompat animation) {
                if (isImeAnimation(animation)) {
                    imeAnimationRunning = true;
                    deferredInsets = null;
                }
            }

            @Override
            public WindowInsetsAnimationCompat.BoundsCompat onStart(
                WindowInsetsAnimationCompat animation,
                WindowInsetsAnimationCompat.BoundsCompat bounds
            ) {
                return bounds;
            }

            @Override
            public WindowInsetsCompat onProgress(WindowInsetsCompat insets, List<WindowInsetsAnimationCompat> runningAnimations) {
                lastInsets = insets;
                applyInsets(host, insets, true);
                return insets;
            }

            @Override
            public void onEnd(WindowInsetsAnimationCompat animation) {
                if (!isImeAnimation(animation)) return;
                imeAnimationRunning = false;
                WindowInsetsCompat finalInsets = deferredInsets != null ? deferredInsets : lastInsets;
                deferredInsets = null;
                if (finalInsets != null) applyInsets(host, finalInsets, false);
                ViewCompat.requestApplyInsets(host);
            }
        });

        imeLayoutListener = (view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> {
            if (lastInsets == null) return;
            if (!isImeVisible(lastInsets) && host.getHeight() > 0) {
                if (host.getWidth() != baselineHostWidth) {
                    baselineHostWidth = host.getWidth();
                    baselineHostHeight = host.getHeight();
                } else if (host.getHeight() >= baselineHostHeight) {
                    // Keep the largest stable height. During an adjustResize
                    // transition the layout callback can arrive before the
                    // IME inset callback and briefly report a smaller frame.
                    baselineHostHeight = host.getHeight();
                }
            }
            if (!imeAnimationRunning) applyInsets(host, lastInsets, false);
        };
        host.addOnLayoutChangeListener(imeLayoutListener);

        WindowInsetsCompat currentInsets = ViewCompat.getRootWindowInsets(host);
        if (currentInsets != null) {
            lastInsets = currentInsets;
            applyInsets(host, currentInsets, false);
        }
        ViewCompat.requestApplyInsets(host);
        ViewCompat.requestApplyInsets(animationHost);
    }

    private void applyInsets(View host, WindowInsetsCompat insets, boolean animated) {
        Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        Insets gestures = insets.getInsets(WindowInsetsCompat.Type.systemGestures());
        Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());

        int safeBottom = Math.max(bars.bottom, gestures.bottom);
        int rawImeExtra = Math.max(0, ime.bottom - safeBottom);
        // On API 26-29 adjustResize can physically reduce the host while the
        // IME inset is also reported. Subtract the measured reduction so the
        // keyboard is accounted for exactly once.
        int physicalResize = baselineHostHeight > 0
            ? Math.max(0, baselineHostHeight - host.getHeight())
            : 0;
        int effectiveIme = Math.max(0, rawImeExtra - physicalResize);
        int bottom = safeBottom + effectiveIme;

        host.setPadding(
            initialLeft + Math.max(bars.left, gestures.left),
            initialTop + bars.top,
            initialRight + Math.max(bars.right, gestures.right),
            initialBottom + bottom
        );
        appliedInsets = insets;
        dispatchImeInset(effectiveIme, animated);
    }

    private void dispatchImeInset(int imeInset, boolean animated) {
        if (imeWebView == null || imeWebView.getUrl() == null) return;
        if (lastDispatchedIme == imeInset) return;
        lastDispatchedIme = imeInset;
        String script = "window.dispatchEvent(new CustomEvent('creative-workbench-ime',{detail:{bottom:"
            + imeInset
            + ",visible:"
            + (imeInset > 0 ? "true" : "false")
            + ",animated:"
            + (animated ? "true" : "false")
            + "}}));";
        try {
            imeWebView.evaluateJavascript(script, null);
        } catch (IllegalStateException ignored) {
            // The WebView can be tearing down while the activity loses focus;
            // the next inset dispatch will re-establish the state.
        }
    }

    private static boolean isImeAnimation(WindowInsetsAnimationCompat animation) {
        return (animation.getTypeMask() & WindowInsetsCompat.Type.ime()) != 0;
    }

    private static boolean isImeVisible(WindowInsetsCompat insets) {
        Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        Insets gestures = insets.getInsets(WindowInsetsCompat.Type.systemGestures());
        Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
        int safeBottom = Math.max(bars.bottom, gestures.bottom);
        return insets.isVisible(WindowInsetsCompat.Type.ime()) || ime.bottom > safeBottom + 24;
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && imeHost != null) ViewCompat.requestApplyInsets(imeHost);
    }

    @Override
    public void onResume() {
        super.onResume();
        lastDispatchedIme = -1;
        if (imeHost != null) ViewCompat.requestApplyInsets(imeHost);
    }

    @Override
    public void onDestroy() {
        if (imeHost != null && imeLayoutListener != null) {
            imeHost.removeOnLayoutChangeListener(imeLayoutListener);
            ViewCompat.setOnApplyWindowInsetsListener(imeHost, null);
        }
        if (getWindow() != null) {
            ViewCompat.setWindowInsetsAnimationCallback(getWindow().getDecorView(), null);
        }
        imeHost = null;
        imeWebView = null;
        super.onDestroy();
    }

}
