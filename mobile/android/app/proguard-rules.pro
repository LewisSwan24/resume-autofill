# R8 / ProGuard rules for Resume Autofill (Capacitor plugins, WebView JS bridges, and offline IME service)

-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable

# Capacitor runtime annotations & plugin lifecycle methods
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod <methods>;
    @com.getcapacitor.annotation.PluginMethod <methods>;
    @com.getcapacitor.annotation.ActivityCallback <methods>;
    @com.getcapacitor.annotation.PermissionCallback <methods>;
}

# App entrypoints, background receivers, providers, and isolated IME service
-keep class app.raf.dev.MainActivity { *; }
-keep class app.raf.dev.ShortcutActivity { *; }
-keep class app.raf.dev.ReminderReceiver { *; }
-keep class app.raf.dev.BootReceiver { *; }
-keep class app.raf.dev.ChooserStreamProvider { *; }
-keep class app.raf.dev.keyboard.** { *; }
-keep class app.raf.dev.VaultCrypto { *; }

# Keep @JavascriptInterface callbacks (if any) and WebView message listeners
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
