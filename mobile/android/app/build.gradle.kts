plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

// Release signing comes from CI secrets (see docs/mobile-apps.md). Without
// them the release build is left unsigned rather than signed with a key that
// would later have to be replaced: Play ties an app to its upload key.
val releaseKeystore: String? = System.getenv("ANDROID_KEYSTORE_PATH")?.takeIf { it.isNotBlank() }

android {
  namespace = "ai.unoblox.works.mobile"
  compileSdk = 36

  defaultConfig {
    applicationId = "ai.unoblox.works.mobile"
    minSdk = 26
    targetSdk = 36
    versionCode = (System.getenv("MOBILE_VERSION_CODE") ?: "1").toInt()
    versionName = System.getenv("MOBILE_VERSION_NAME") ?: "0.1.0"
    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
  }

  signingConfigs {
    if (releaseKeystore != null) {
      create("release") {
        storeFile = file(releaseKeystore)
        storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
        keyAlias = System.getenv("ANDROID_KEY_ALIAS")
        keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
      }
    }
  }

  buildTypes {
    release {
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
      if (releaseKeystore != null) signingConfig = signingConfigs.getByName("release")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  buildFeatures {
    buildConfig = true
  }

  testOptions {
    unitTests.all { test ->
      // The shared fixtures live outside this Gradle project.
      test.systemProperty("pairingFixtures", rootProject.file("../shared/pairing-links.json").absolutePath)
    }
  }
}

kotlin {
  compilerOptions {
    jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
  }
}

dependencies {
  implementation("androidx.core:core-ktx:1.16.0")
  implementation("androidx.appcompat:appcompat:1.7.1")
  implementation("androidx.activity:activity-ktx:1.10.1")
  implementation("com.google.android.material:material:1.12.0")
  implementation("androidx.webkit:webkit:1.14.0")
  implementation("androidx.camera:camera-camera2:1.4.2")
  implementation("androidx.camera:camera-lifecycle:1.4.2")
  implementation("androidx.camera:camera-view:1.4.2")
  // ZXing rather than ML Kit or the Play services scanner: it needs no Google
  // Play services, so the scanner also works on phones sold without them.
  implementation("com.google.zxing:core:3.5.3")

  testImplementation("junit:junit:4.13.2")
  // android.jar only stubs org.json; unit tests need the real implementation.
  testImplementation("org.json:json:20250517")

  androidTestImplementation("androidx.test.ext:junit:1.2.1")
  androidTestImplementation("androidx.test:runner:1.6.2")
  androidTestImplementation("androidx.test:core:1.6.1")
}
