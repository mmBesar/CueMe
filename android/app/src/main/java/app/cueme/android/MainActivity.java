package app.cueme.android;

import android.app.Activity;
import android.Manifest;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.net.wifi.WifiManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;

import java.io.File;

/**
 * CueMe for Android: a WebView showing the CueMe UI served by the Rust hub that
 * runs inside this app. Works as a display, as a remote, or both at once, with
 * no other device required. Plain android.app.Activity (no AndroidX) so the same
 * code runs from Android 6.0.
 */
public class MainActivity extends Activity {
    private WebView web;
    private volatile boolean fullscreen = false;
    private String baseUrl;
    private WifiManager.MulticastLock mcast;
    private PermissionRequest pendingCamera;
    private static final int REQ_CAMERA = 7;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        TextView loading = new TextView(this);
        loading.setText("CueMe...");
        loading.setTextColor(Color.WHITE);
        loading.setBackgroundColor(Color.BLACK);
        loading.setGravity(android.view.Gravity.CENTER);
        setContentView(loading);

        final File files = getFilesDir();
        File ext = getExternalFilesDir(null);
        final File dataDir = new File(files, "cueme");
        final File libDir = new File(ext != null ? ext : files, "scripts");
        final String name = Build.MODEL == null ? "Android" : Build.MODEL.replaceAll("[^A-Za-z0-9-]", "-");

        new Thread(new Runnable() {
            @Override
            public void run() {
                final String res;
                String r;
                try {
                    r = Hub.nativeStart(dataDir.getAbsolutePath(), libDir.getAbsolutePath(), name);
                } catch (Throwable t) {
                    r = "ERR:" + t;
                }
                res = r;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        onHubStarted(res);
                    }
                });
            }
        }, "cueme-hub-start").start();
    }

    private void onHubStarted(String res) {
        if (res == null || res.startsWith("ERR:")) {
            TextView err = new TextView(this);
            err.setText("CueMe could not start\n" + res);
            err.setTextColor(Color.WHITE);
            err.setBackgroundColor(Color.BLACK);
            err.setPadding(32, 32, 32, 32);
            setContentView(err);
            return;
        }
        String[] parts = res.split("\\|", -1);
        baseUrl = "http://127.0.0.1:" + parts[0] + "/";
        String url = baseUrl + "#pin=" + parts[1];

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setWebChromeClient(new WebChromeClient() {
            // QR scanning: only the app's own page may use the camera, and only video.
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        handleCameraRequest(request);
                    }
                });
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingCamera == request) pendingCamera = null;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            // Never leave the local CueMe UI (script links must not hijack the prompter).
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, String u) {
                return !(u != null && baseUrl != null && u.startsWith(baseUrl));
            }
        });
        web.addJavascriptInterface(new Bridge(), "CueNative");
        setContentView(web);
        web.loadUrl(url);
    }

    private void handleCameraRequest(PermissionRequest request) {
        boolean ours = baseUrl != null && request.getOrigin() != null
                && (request.getOrigin().toString() + "/").startsWith(baseUrl);
        boolean wantsVideo = false;
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) wantsVideo = true;
        }
        if (!ours || !wantsVideo) {
            request.deny();
            return;
        }
        if (Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
        } else {
            pendingCamera = request;
            requestPermissions(new String[] { Manifest.permission.CAMERA }, REQ_CAMERA);
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (code != REQ_CAMERA || pendingCamera == null) return;
        PermissionRequest r = pendingCamera;
        pendingCamera = null;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            r.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
        } else {
            r.deny();
        }
    }

    private void setMulticast(boolean on) {
        try {
            if (on) {
                if (mcast == null) {
                    WifiManager wm = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
                    if (wm == null) return;
                    mcast = wm.createMulticastLock("cueme");
                    mcast.setReferenceCounted(false);
                }
                if (!mcast.isHeld()) mcast.acquire();
            } else if (mcast != null && mcast.isHeld()) {
                mcast.release();
            }
        } catch (Throwable ignored) {
            // discovery is a convenience; typing the address always works
        }
    }

    /** Exposed to the page as window.CueNative. */
    private class Bridge {
        @JavascriptInterface
        public boolean toggleFullscreen() {
            fullscreen = !fullscreen;
            final boolean on = fullscreen;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    applyFullscreen(on);
                }
            });
            return on;
        }

        /** Colour the status bar and the navigation bar like the app; `light` = dark icons for light colours. */
        @JavascriptInterface
        public void setBars(final String hex, final boolean light) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    applyBars(hex, light);
                }
            });
        }

        /** Is the phone in dark mode? (the page's "Auto" theme follows this) */
        @JavascriptInterface
        public boolean isDark() {
            return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                    == Configuration.UI_MODE_NIGHT_YES;
        }

        /** Android 12+ system accent colour as #rrggbb, or "" when the phone has none. */
        @JavascriptInterface
        public String accent() {
            try {
                if (Build.VERSION.SDK_INT >= 31) {
                    int c = getResources().getColor(android.R.color.system_accent1_400, getTheme());
                    return String.format("#%06x", c & 0xFFFFFF);
                }
            } catch (Throwable ignored) {
                // no system colours: the page simply does not offer that swatch
            }
            return "";
        }
    }

    private boolean lightBars = false;

    @SuppressWarnings("deprecation")
    private void applyBars(String hex, boolean light) {
        try {
            int c = Color.parseColor(hex);
            lightBars = light;
            if (Build.VERSION.SDK_INT >= 21) {
                getWindow().clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS
                        | WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
                getWindow().setStatusBarColor(c);
                getWindow().setNavigationBarColor(c);
            }
            if (web != null) web.setBackgroundColor(c);
            if (!fullscreen) applyFullscreen(false);
        } catch (Throwable ignored) {
            // a bad colour string only means the bars keep their colour
        }
    }

    @SuppressWarnings("deprecation")
    private void applyFullscreen(boolean on) {
        View decor = getWindow().getDecorView();
        if (on) {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        } else {
            int flags = View.SYSTEM_UI_FLAG_VISIBLE;
            if (lightBars && Build.VERSION.SDK_INT >= 23) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
            if (lightBars && Build.VERSION.SDK_INT >= 26) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            decor.setSystemUiVisibility(flags);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && fullscreen) applyFullscreen(true);
    }

    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript(
                "(function(){var c=window.__cueme;if(c&&c.back&&c.back()){return 'y';}return 'n';})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String v) {
                        if (v == null || !v.contains("y")) finish();
                    }
                });
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig); // resize is handled by the page
    }

    @Override
    protected void onResume() {
        super.onResume();
        setMulticast(true);
        if (web != null) web.onResume();
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        setMulticast(false);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (isFinishing()) {
            try {
                Hub.nativeStop();
            } catch (Throwable ignored) {
            }
        }
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
