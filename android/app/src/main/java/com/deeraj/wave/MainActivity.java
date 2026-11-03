package com.deeraj.wave;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Capacitor 7 builds the whole bridge INSIDE super.onCreate() (onCreate →
     * load() → Builder.create(), and create() iterates the builder's plugin list
     * exactly once). A plugin registered in onCreate after super.onCreate() only
     * queues into that already-consumed list — it silently never exists, and every
     * WaveAudio.* call from JS dies with "plugin not implemented": no foreground
     * service, no media card, no notification-permission ask, no keep-alive.
     * load() is the one hook that runs BEFORE the bridge is created — register
     * there, then let super.load() consume the list for real.
     */
    @Override
    protected void load() {
        registerPlugin(WaveAudioPlugin.class);
        super.load();
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Queue/radio auto-advance calls audio.play() without a user gesture —
        // WebView's default block would stall the second song and onward.
        bridge.getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
        // Pull-to-refresh is Wave's own JS gesture (PullToRefresh.tsx) — kill the
        // WebView's native overscroll stretch/glow so it is the only response.
        bridge.getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);
        // The media-notification card routes its transport buttons into the web
        // player through window.__waveMediaAction on this WebView.
        MediaPlaybackService.setWebView(bridge.getWebView());
        // Android 13+: the media card is invisible until POST_NOTIFICATIONS is
        // granted. Ask at startup AND at first audible play (the plugin asks too) —
        // two clean chances; after two denials only Settings → Notifications works.
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 20261);
        }
    }

    @Override
    public void onBackPressed() {
        // Back closes Wave's layers first (⋮ sheet → queue → full player — decided
        // by window.__waveBack in the web app). Only when everything is already
        // closed do we MINIMIZE instead of finishing the activity: moveTaskToBack
        // keeps the foreground service and the music playing (YTM's back behavior).
        bridge.getWebView().evaluateJavascript(
            "(function(){ try { return !!(window.__waveBack && window.__waveBack()); } catch (e) { return false; } })()",
            value -> {
                if (!"true".equals(value)) {
                    moveTaskToBack(true);
                }
            });
    }
}
