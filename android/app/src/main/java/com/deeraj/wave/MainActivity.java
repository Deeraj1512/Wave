package com.deeraj.wave;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Queue/radio auto-advance calls audio.play() without a user gesture —
        // WebView's default block would stall the second song and onward.
        bridge.getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
        // Background play: JS calls WaveAudio.start()/stop() around audible playback
        // to run the foreground mediaPlayback service (keeps the process alive).
        registerPlugin(WaveAudioPlugin.class);
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
