package com.deeraj.wave;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.ActivityCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS bridge for background audio. The web player calls:
 *   WaveAudio.start()  — audible playback begins (foreground service + card appear)
 *   WaveAudio.stop()   — playback is gone for good (queue emptied → card dismissed)
 *   WaveAudio.update() — card content / play-pause state changed (track, pause, play)
 *   WaveAudio.requestNotificationPermission() — Android 13+ POST_NOTIFICATIONS dialog
 *
 * All methods are idempotent — extra calls are harmless. A service-start failure
 * (rare OEM kills) must never break playback.
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

    /**
     * Push card content: title, artist, album, cover URL, playing state. While
     * paused the service keeps the card alive (▶ button), so updates flow even
     * when nothing is audible — but we never spawn the service just to show a
     * paused card the user never started playing.
     */
    @PluginMethod
    public void update(PluginCall call) {
        Context ctx = getContext();
        boolean playing = Boolean.TRUE.equals(call.getBoolean("playing"));
        if (!MediaPlaybackService.running && !playing) {
            call.resolve();
            return;
        }
        Intent i = new Intent(ctx, MediaPlaybackService.class);
        i.setAction(MediaPlaybackService.ACTION_UPDATE);
        i.putExtra(MediaPlaybackService.EXTRA_TITLE, orEmpty(call.getString("title")));
        i.putExtra(MediaPlaybackService.EXTRA_ARTIST, orEmpty(call.getString("artist")));
        i.putExtra(MediaPlaybackService.EXTRA_ALBUM, orEmpty(call.getString("album")));
        i.putExtra(MediaPlaybackService.EXTRA_COVER, orEmpty(call.getString("cover")));
        i.putExtra(MediaPlaybackService.EXTRA_PLAYING, playing);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(i);
            } else {
                ctx.startService(i);
            }
        } catch (Exception ignored) {
        }
        call.resolve();
    }

    /**
     * Android 13+ hides every notification — including the media card — until
     * POST_NOTIFICATIONS is granted. Asked once from the first audible play.
     */
    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        Activity act = getActivity();
        if (act != null && Build.VERSION.SDK_INT >= 33) {
            try {
                ActivityCompat.requestPermissions(act,
                        new String[]{Manifest.permission.POST_NOTIFICATIONS}, 20261);
            } catch (Exception ignored) {
            }
        }
        call.resolve();
    }

    private static String orEmpty(String s) {
        return s == null ? "" : s;
    }
}
