import {
  parseCargoToml,
  parsePodfile,
  parseComposerJson,
  parseGoMod,
  parseMixExs,
  parseGradleBuild,
  parseGradleVersionCatalog,
  parsePomXml,
  parsePubspecYaml,
  parsePackageSwift,
} from '@programs/warehouse-sources/manifests';

describe('manifest parsers', () => {
  it('Cargo.toml: every dependency table, renames, and not array tables', () => {
    const content = `[package]
name = "app"

[dependencies]
sentry = "0.32"
tokio = { version = "1", features = ["full"] }
stripe = { package = "async-stripe", version = "0.34" }

[target.'cfg(unix)'.dev-dependencies]
openssl = "0.10"

[dependencies.reqwest]
version = "0.12"

[[bin]]
name = "not-a-dependency"

[workspace.dependencies]
serde = "1"
`;
    expect(parseCargoToml(content)).toEqual([
      'sentry',
      'tokio',
      'async-stripe',
      'openssl',
      'reqwest',
      'serde',
    ]);
  });

  it('Cargo.toml: dotted keys, commented headers, and renamed dependency tables', () => {
    const content = `[dependencies] # runtime
sentry.workspace = true
tokio.version = "1"
tokio.features = ["full"]
stripe.package = "async-stripe"
stripe.version = "0.34"

[dependencies.http] # renamed
package = "reqwest"
version = "0.12"
`;
    expect(parseCargoToml(content)).toEqual([
      'sentry',
      'tokio',
      'async-stripe',
      'reqwest',
    ]);
  });

  it('Podfile: pod names, subspecs reported as their pod', () => {
    const content = `target 'App' do
  pod 'Sentry', '~> 8.0'
  pod "Firebase/Analytics"
end`;
    expect(parsePodfile(content)).toEqual(['Sentry', 'Firebase']);
  });

  it('composer.json: require and require-dev, without php or extensions', () => {
    const content = JSON.stringify({
      require: { php: '^8.2', 'ext-json': '*', 'Sentry/Sentry-Laravel': '^4' },
      'require-dev': { 'mixpanel/mixpanel-php': '^2' },
    });
    expect(parseComposerJson(content)).toEqual([
      'sentry/sentry-laravel',
      'mixpanel/mixpanel-php',
    ]);
  });

  it('go.mod: direct requirements, a final major version dropped, case kept', () => {
    const content = `module example.com/app

go 1.22

require github.com/getsentry/sentry-go v0.27.0

require (
\tgithub.com/stripe/stripe-go/v82 v82.0.0
\tgopkg.in/DataDog/dd-trace-go.v1 v1.60.0
\tgithub.com/Masterminds/semver/v3 v3.2.1 // indirect
)
`;
    expect(parseGoMod(content)).toEqual([
      'github.com/getsentry/sentry-go',
      'github.com/stripe/stripe-go',
      'gopkg.in/DataDog/dd-trace-go.v1',
    ]);
  });

  it('mix.exs: dependency tuples', () => {
    const content = `defp deps do
  [
    {:phoenix, "~> 1.7"},
    {:sentry, "~> 10.0"},
    { :hackney, "~> 1.8", only: :prod }
  ]
end`;
    expect(parseMixExs(content)).toEqual(['phoenix', 'sentry', 'hackney']);
  });

  it('build.gradle(.kts): string coordinates and map notation', () => {
    const content = `dependencies {
    implementation("io.sentry:sentry-android:7.14.0")
    implementation 'com.mixpanel.android:mixpanel-android:7.+'
    implementation group: 'com.amplitude', name: 'analytics-android', version: '1.16.0'
    implementation(libs.posthog)
}
repositories { maven { url "https://jitpack.io" } }`;
    expect(parseGradleBuild(content)).toEqual([
      'io.sentry:sentry-android',
      'com.mixpanel.android:mixpanel-android',
      'com.amplitude:analytics-android',
    ]);
  });

  it('libs.versions.toml: module, group and name, and plain coordinates', () => {
    const content = `[versions]
sentry = "7.14.0"

[libraries]
sentry = { module = "io.sentry:sentry-android", version.ref = "sentry" }
amplitude = { group = "com.amplitude", name = "analytics-android", version = "1.16.0" }
mixpanel = "com.mixpanel.android:mixpanel-android:7.5.2"
`;
    expect(parseGradleVersionCatalog(content)).toEqual([
      'io.sentry:sentry-android',
      'com.amplitude:analytics-android',
      'com.mixpanel.android:mixpanel-android',
    ]);
  });

  it('pom.xml: groupId and artifactId per dependency', () => {
    const content = `<project><dependencies>
  <dependency>
    <groupId>io.sentry</groupId>
    <artifactId>sentry-spring-boot-starter</artifactId>
    <version>7.14.0</version>
  </dependency>
</dependencies></project>`;
    expect(parsePomXml(content)).toEqual([
      'io.sentry:sentry-spring-boot-starter',
    ]);
  });

  it('pubspec.yaml: top-level dependencies and dev_dependencies only', () => {
    const content = `name: app
dependencies:
  flutter:
    sdk: flutter
  sentry_flutter: ^8.0.0
dev_dependencies:
  mixpanel_flutter: ^2.0.0
flutter:
  uses-material-design: true
`;
    expect(parsePubspecYaml(content)).toEqual([
      'flutter',
      'sentry_flutter',
      'mixpanel_flutter',
    ]);
  });

  it('Package.swift: package URLs without scheme or .git, lowercased', () => {
    const content = `dependencies: [
    .package(url: "https://github.com/getsentry/sentry-cocoa.git", from: "8.0.0"),
    .package(url: "git@github.com:Amplitude/Amplitude-Swift.git", from: "1.0.0"),
]`;
    expect(parsePackageSwift(content)).toEqual([
      'github.com/getsentry/sentry-cocoa',
      'github.com/amplitude/amplitude-swift',
    ]);
  });
});
