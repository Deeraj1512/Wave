package com.deeraj.wave;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
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
 *   WaveAudio.getNativeState() — is the service alive & audible? Lets a reloaded
 *       WebView tell pull-to-refresh (resume audible) from open-after-kill (paused).
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
        // seek-bar feed (seconds): duration makes Android render the card's bar
        // at all; position anchors it to truth (the service extrapolates in
        // between). Absent keys → no extra → the service keeps its own value.
        Double durationSec = call.getDouble("duration");
        if (durationSec != null && durationSec > 0 && !durationSec.isNaN()) {
            i.putExtra(MediaPlaybackService.EXTRA_DURATION, durationSec);
        }
        Double positionSec = call.getDouble("position");
        if (positionSec != null && positionSec >= 0 && !positionSec.isNaN()) {
            i.putExtra(MediaPlaybackService.EXTRA_POSITION, positionSec);
        }
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

    /**
     * The freshly reloaded WebView's source of truth: is the native side still
     * actually playing? A pull-to-refresh reloads the page while the foreground
     * service never died → running + playing → the player may resume audible.
     * After a kill the service is gone → running=false → the player must come
     * back PAUSED (song + position restored, user taps ▶), never auto-play.
     */
    @PluginMethod
    public void getNativeState(PluginCall call) {
        JSObject state = new JSObject();
        state.put("running", MediaPlaybackService.running);
        state.put("playing", MediaPlaybackService.playingNow);
        call.resolve(state);
    }

    /**
     * Loudness boost (Batch 2) — the honest native lever. The WebView's audio
     * element caps at 1.0 and googlevideo streams carry no CORS headers, so a
     * Web Audio gain chain is off-limits in the APK (it would output silence);
     * the real phone-side boost is the system MEDIA volume itself.
     *   mediaVolume()    → {current, max} for the UI slider state
     *   raiseMediaVolume → moves STREAM_MUSIC by `steps` (negative lowers it),
     *                      clamped to [0, max], without popping the system HUD
     */
    @PluginMethod
    public void mediaVolume(PluginCall call) {
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                JSObject out = new JSObject();
                out.put("current", am.getStreamVolume(AudioManager.STREAM_MUSIC));
                out.put("max", am.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
                call.resolve(out);
                return;
            }
        } catch (Exception ignored) {
        }
        call.resolve();
    }

    @PluginMethod
    public void raiseMediaVolume(PluginCall call) {
        Integer stepsObj = call.getInt("steps");
        int steps = stepsObj != null ? stepsObj : 1;
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
                int cur = am.getStreamVolume(AudioManager.STREAM_MUSIC);
                int next = Math.max(0, Math.min(max, cur + steps));
                if (next != cur) {
                    am.setStreamVolume(AudioManager.STREAM_MUSIC, next, 0); // flags=0 → no HUD pop
                }
                JSObject out = new JSObject();
                out.put("current", next);
                out.put("max", max);
                call.resolve(out);
                return;
            }
        } catch (Exception ignored) {
        }
        call.resolve();
    }

    private static String orEmpty(String s) {
        return s == null ? "" : s;
    }
}
