package com.deeraj.wave;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.webkit.WebView;

import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

import java.io.InputStream;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Foreground media-playback service — Wave's notification / lock-screen card.
 *
 * Two jobs, one service:
 *  1. KEEP-ALIVE: Capacitor's bridge never pauses the WebView, but once the activity
 *     is backgrounded the process becomes cached and Android freezes/kills it —
 *     killing the WebView's audio. Holding a foreground service with the
 *     mediaPlayback type keeps the process alive; the partial wake lock (held only
 *     while actually playing) keeps CPU/network up with the screen off.
 *  2. CONTROLS: a MediaStyle notification bound to a real MediaSession —
 *     previous / play-pause / next buttons, song + artist + album + cover art,
 *     lock-screen visibility. Every button (and every headset/bluetooth media key
 *     via the session callbacks) is routed INTO the web player through
 *     window.__waveMediaAction(action) on the live WebView, so the HTML5 audio
 *     element stays the single source of playback truth.
 *
 * Started from JS via the WaveAudio plugin (start/stop/update). The card survives
 * pause (YTM behavior — the button flips to ▶ so playback resumes from the shade);
 * it is dismissed by JS pushing meta=null (queue emptied) or the user swiping it
 * while paused.
 */
public class MediaPlaybackService extends Service {
    private static final String CHANNEL_ID = "wave_playback";
    private static final int NOTIFICATION_ID = 1;
    private static final int REQ_PLAY = 11;
    private static final int REQ_PAUSE = 12;
    private static final int REQ_NEXT = 13;
    private static final int REQ_PREV = 14;
    private static final int REQ_OPEN = 15;
    private static final int REQ_DELETE = 16;

    static final String ACTION_PLAY = "com.deeraj.wave.media.PLAY";
    static final String ACTION_PAUSE = "com.deeraj.wave.media.PAUSE";
    static final String ACTION_NEXT = "com.deeraj.wave.media.NEXT";
    static final String ACTION_PREV = "com.deeraj.wave.media.PREV";
    static final String ACTION_UPDATE = "com.deeraj.wave.media.UPDATE";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_ARTIST = "artist";
    static final String EXTRA_ALBUM = "album";
    static final String EXTRA_COVER = "cover";
    static final String EXTRA_PLAYING = "playing";
    static final String EXTRA_DURATION = "duration";
    static final String EXTRA_POSITION = "position";

    /** The live WebView (set by MainActivity) — transport actions are evaluated into the web player. */
    private static WeakReference<WebView> webViewRef = new WeakReference<>(null);

    static void setWebView(WebView wv) {
        webViewRef = new WeakReference<>(wv);
    }

    /** True while this service exists — the plugin consults it before spawning updates. */
    static volatile boolean running = false;

    private MediaSessionCompat session;
    private PowerManager.WakeLock wakeLock;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService artExecutor = Executors.newSingleThreadExecutor();

    // current card state — updated via ACTION_UPDATE intents from the plugin
    private String title = "Wave";
    private String artist = "Playing in background";
    private String album = "";
    private String coverUrl = "";
    private boolean playing = false;
    private Bitmap art;
    private String loadedArtUrl = "";
    private boolean artInFlight = false;

    // seek-bar state: duration from JS, position anchored at the last
    // applySessionState() and extrapolated against the wall clock while playing
    private long durationMs = 0;
    private long positionMs = 0;
    private float speedAtSet = 0f;
    private long setAtElapsed = 0L;

    /** The bar's true position right now: the anchored position advanced by the
     *  elapsed playing time (clamped to the track), frozen when paused. */
    private long extrapolatedPositionMs() {
        if (speedAtSet <= 0) return positionMs;
        long elapsed = SystemClock.elapsedRealtime() - setAtElapsed;
        long pos = positionMs + (long) (elapsed * speedAtSet);
        if (durationMs > 0 && pos > durationMs) pos = durationMs;
        return Math.max(0, pos);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Playback",
                    NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        session = new MediaSessionCompat(this, "Wave");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                dispatch("play");
            }

            @Override
            public void onPause() {
                dispatch("pause");
            }

            @Override
            public void onSkipToNext() {
                dispatch("next");
            }

            @Override
            public void onSkipToPrevious() {
                dispatch("prev");
            }

            @Override
            public void onSeekTo(long pos) {
                // jump the bar immediately (no snap-back while the JS round-trip
                // runs) and let the player adopt the same second
                positionMs = Math.max(0, pos);
                speedAtSet = 0f;
                applySessionState();
                dispatch("seek", pos / 1000.0);
            }
        });
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_PLAY.equals(action)) {
            dispatch("play");
        } else if (ACTION_PAUSE.equals(action)) {
            dispatch("pause");
        } else if (ACTION_NEXT.equals(action)) {
            dispatch("next");
        } else if (ACTION_PREV.equals(action)) {
            dispatch("prev");
        } else if (ACTION_UPDATE.equals(action)) {
            String t = intent.getStringExtra(EXTRA_TITLE);
            if (t != null && !t.trim().isEmpty()) title = t.trim();
            String a = intent.getStringExtra(EXTRA_ARTIST);
            if (a != null && !a.trim().isEmpty()) artist = a.trim();
            String al = intent.getStringExtra(EXTRA_ALBUM);
            album = al == null ? "" : al.trim();
            String c = intent.getStringExtra(EXTRA_COVER);
            coverUrl = c == null ? "" : c.trim();
            playing = intent.getBooleanExtra(EXTRA_PLAYING, playing);
            // seek-bar feed — duration in s → ms; an explicit position anchors
            // the bar, otherwise it keeps its own extrapolated truth
            if (intent.hasExtra(EXTRA_DURATION)) {
                double d = intent.getDoubleExtra(EXTRA_DURATION, 0);
                durationMs = d > 0 ? (long) (d * 1000.0) : 0;
            }
            if (intent.hasExtra(EXTRA_POSITION)) {
                double p = intent.getDoubleExtra(EXTRA_POSITION, 0);
                positionMs = Math.max(0, (long) (p * 1000.0));
            } else {
                positionMs = extrapolatedPositionMs();
            }
        } else {
            // transport intents (play/pause/next/prev from the card itself)
            // carry no position — freeze/advance the bar where it really is
            positionMs = extrapolatedPositionMs();
        }

        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
        applySessionState();

        // wake lock only while audible — a paused card must not pin the CPU
        if (playing) {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Wave:playback");
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null && !wakeLock.isHeld()) {
                // 4h hard cap: a stuck service can never pin the CPU forever
                wakeLock.acquire(4 * 60 * 60 * 1000L);
            }
        } else if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        return START_NOT_STICKY;
    }

    /** Push title/artist/album/art + play state into the MediaSession and refresh the card. */
    private void applySessionState() {
        if (session != null) {
            try {
                long now = SystemClock.elapsedRealtime();
                session.setPlaybackState(new PlaybackStateCompat.Builder()
                        .setActions(PlaybackStateCompat.ACTION_PLAY
                                | PlaybackStateCompat.ACTION_PAUSE
                                | PlaybackStateCompat.ACTION_PLAY_PAUSE
                                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                                | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                                | PlaybackStateCompat.ACTION_SEEK_TO)
                        .setState(playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                                positionMs, playing ? 1f : 0f, now)
                        .build());
                positionMs = Math.max(0, positionMs);
                speedAtSet = playing ? 1f : 0f;
                setAtElapsed = now;
                MediaMetadataCompat.Builder mb = new MediaMetadataCompat.Builder()
                        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist);
                if (!album.isEmpty()) mb.putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album);
                // THE seek-bar enabler: Android renders the card's bar only when
                // the metadata carries a duration AND the state supports seek
                if (durationMs > 0) mb.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs);
                if (art != null) mb.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art);
                session.setMetadata(mb.build());
            } catch (Exception ignored) {
                // a grumpy session must never take the service down
            }
        }
        loadArtIfNeeded();
    }

    /** Fetch cover art off-thread (hqdefault-sized URL from JS) and refresh the card when it lands. */
    private void loadArtIfNeeded() {
        final String url = coverUrl;
        if (url.isEmpty() || url.equals(loadedArtUrl) || artInFlight) return;
        artInFlight = true;
        artExecutor.execute(() -> {
            Bitmap bmp = null;
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);
                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Wave)");
                InputStream in = conn.getInputStream();
                bmp = BitmapFactory.decodeStream(in);
                in.close();
                conn.disconnect();
            } catch (Exception ignored) {
                // art is cosmetic
            }
            final Bitmap fBmp = bmp;
            main.post(() -> {
                artInFlight = false;
                if (fBmp != null) {
                    art = fBmp;
                    loadedArtUrl = url;
                    applySessionState();
                    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                    if (nm != null && running) {
                        try {
                            nm.notify(NOTIFICATION_ID, buildNotification());
                        } catch (Exception ignored) {
                        }
                    }
                }
            });
        });
    }

    /** Route a transport action into the web player. Must run on the main thread. */
    private void dispatch(String action) {
        dispatch(action, Double.NaN);
    }

    /** dispatch with an optional numeric argument (the card's seek target, seconds). */
    private void dispatch(String action, double posSec) {
        WebView wv = webViewRef.get();
        if (wv == null) return;
        try {
            String posArg = Double.isNaN(posSec) ? "" : "," + posSec;
            String js = "(function(){try{if(typeof window.__waveMediaAction==='function'){window.__waveMediaAction('"
                    + action + "'" + posArg + ");return true}return false}catch(e){return false}})()";
            wv.evaluateJavascript(js, null);
        } catch (Exception ignored) {
            // activity torn down (app swiped away) — nothing to control
        }
    }

    private PendingIntent actionPi(String action, int req) {
        Intent i = new Intent(this, MediaPlaybackService.class).setAction(action);
        return PendingIntent.getService(this, req, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification buildNotification() {
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent openPi = open != null
                ? PendingIntent.getActivity(this, REQ_OPEN, open,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)
                : null;
        // swiping a paused card away pauses playback in the player too
        PendingIntent deletePi = actionPi(ACTION_PAUSE, REQ_DELETE);
        String subtitle = album.isEmpty() ? artist : artist + " · " + album;
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(title)
                .setContentText(subtitle)
                .setLargeIcon(art)
                .setContentIntent(openPi)
                .setDeleteIntent(deletePi)
                .setOngoing(playing)
                .setOnlyAlertOnce(true)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .addAction(new NotificationCompat.Action(android.R.drawable.ic_media_previous,
                        "Previous", actionPi(ACTION_PREV, REQ_PREV)))
                .addAction(new NotificationCompat.Action(
                        playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        playing ? "Pause" : "Play",
                        actionPi(playing ? ACTION_PAUSE : ACTION_PLAY, playing ? REQ_PAUSE : REQ_PLAY)))
                .addAction(new NotificationCompat.Action(android.R.drawable.ic_media_next,
                        "Next", actionPi(ACTION_NEXT, REQ_NEXT)))
                .setStyle(new MediaStyle()
                        .setMediaSession(session == null ? null : session.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2))
                .build();
    }

    @Override
    public void onDestroy() {
        running = false;
        artExecutor.shutdownNow();
        if (session != null) {
            try {
                session.setActive(false);
                session.release();
            } catch (Exception ignored) {
            }
            session = null;
        }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
