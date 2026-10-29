package com.deeraj.wave;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS bridge for background audio. The web player calls WaveAudio.start() when
 * playback becomes audible and WaveAudio.stop() when it pauses/ends; both manage
 * the foreground mediaPlayback service. Idempotent — extra calls are harmless.
 */
@CapacitorPlugin(name = "WaveAudio")
public class WaveAudioPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        Context ctx = getContext();
        Intent i = new Intent(ctx, MediaPlaybackService.class);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(i);
            } else {
                ctx.startService(i);
            }
        } catch (Exception ignored) {
            // a service-start failure (rare OEM kills) must never break playback
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context ctx = getContext();
        try {
            ctx.stopService(new Intent(ctx, MediaPlaybackService.class));
        } catch (Exception ignored) {
        }
        call.resolve();
    }
}
