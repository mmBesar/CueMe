package app.cueme.android;

/** The Rust CueMe hub (libcueme_android.so), running inside this process. */
final class Hub {
    static {
        System.loadLibrary("cueme_android");
    }

    private Hub() {}

    /** @return "port|pin|lanUrls" or "ERR:message". Idempotent. */
    static native String nativeStart(String dataDir, String libraryDir, String name);

    static native void nativeStop();
}
