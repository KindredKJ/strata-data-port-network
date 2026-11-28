plugins { id("com.android.application") }

android {
    namespace = "ai.kindredlabs.sdpn.mobile"
    compileSdk = 36

    defaultConfig {
        applicationId = "ai.kindredlabs.sdpn.mobile"
        minSdk = 28
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-sw07"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildTypes {
        release { isMinifyEnabled = false }
    }
    testOptions { unitTests.isReturnDefaultValues = true }
}
dependencies {
    testImplementation("junit:junit:4.13.2")
}
