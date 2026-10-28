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
    }
}
