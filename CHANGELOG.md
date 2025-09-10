# Changelog

## [1.14.0](https://github.com/PostHog/wizard/compare/v1.13.2...v1.14.0) (2025-09-10)


### Features

* allow feature selection during MCP setup ([#140](https://github.com/PostHog/wizard/issues/140)) ([91ff2ef](https://github.com/PostHog/wizard/commit/91ff2efe131e32a28cfb336b449f0d99b2fb1e22))


### Bug Fixes

* support node 22 ([#142](https://github.com/PostHog/wizard/issues/142)) ([11d4edb](https://github.com/PostHog/wizard/commit/11d4edb778fd1b6284a8d223af51ebded35d0ea4))

## [1.13.2](https://github.com/PostHog/wizard/compare/v1.13.1...v1.13.2) (2025-09-02)


### Bug Fixes

* improve error capturing for claude code mcp client ([#138](https://github.com/PostHog/wizard/issues/138)) ([2dcf799](https://github.com/PostHog/wizard/commit/2dcf799a968508b28647986a6033f1f64acd1284))

## [1.13.1](https://github.com/PostHog/wizard/compare/v1.13.0...v1.13.1) (2025-08-22)


### Bug Fixes

* better input check in abortIfCancelled ([#131](https://github.com/PostHog/wizard/issues/131)) ([7ac009a](https://github.com/PostHog/wizard/commit/7ac009a3fa354677232936c69ff64db0aea1c4f4))

## [1.13.0](https://github.com/PostHog/wizard/compare/v1.12.0...v1.13.0) (2025-08-21)


### Features

* add zed mcp client ([#128](https://github.com/PostHog/wizard/issues/128)) ([2ac413e](https://github.com/PostHog/wizard/commit/2ac413ed4c4b7d862aabf76977969fe871dfe696))


### Bug Fixes

* wrap claude code mcp error to avoid logging exceptions ([#130](https://github.com/PostHog/wizard/issues/130)) ([41e8296](https://github.com/PostHog/wizard/commit/41e8296905bae0d1f2a2218ed3857c3301f80312))

## [1.12.0](https://github.com/PostHog/wizard/compare/v1.11.0...v1.12.0) (2025-08-21)


### Features

* add vscode mcp client ([#126](https://github.com/PostHog/wizard/issues/126)) ([380ee5b](https://github.com/PostHog/wizard/commit/380ee5b009c54504512c888f89b4db4bf90b5127))

## [1.11.0](https://github.com/PostHog/wizard/compare/v1.10.1...v1.11.0) (2025-08-21)


### Features

* add support for claude code as an MCP client ([#122](https://github.com/PostHog/wizard/issues/122)) ([0419a7d](https://github.com/PostHog/wizard/commit/0419a7d35d8993cf17c37a05fa831f44497c4609))
* beautify mcp cli and add client selection ([#123](https://github.com/PostHog/wizard/issues/123)) ([f6a7e03](https://github.com/PostHog/wizard/commit/f6a7e03e9eb328691a880add97439821fdd49bf1))


### Bug Fixes

* use /sse for cursor ([#121](https://github.com/PostHog/wizard/issues/121)) ([1b942a4](https://github.com/PostHog/wizard/commit/1b942a499e66d461b3da7e14fa53c9a5db9ee4e5))
* vercel env var provider lower case error ([#125](https://github.com/PostHog/wizard/issues/125)) ([34e2790](https://github.com/PostHog/wizard/commit/34e27907a5608b827554554b63ca5e9ea2a434fb))

## [1.10.1](https://github.com/PostHog/wizard/compare/v1.10.0...v1.10.1) (2025-08-19)


### Bug Fixes

* remove /ingest/flags ([#119](https://github.com/PostHog/wizard/issues/119)) ([0431750](https://github.com/PostHog/wizard/commit/043175017954aa1889d8ca6ebbaf2ee8fdd37fed))

## [1.10.0](https://github.com/PostHog/wizard/compare/v1.9.0...v1.10.0) (2025-08-12)


### Features

* prevent users from running wizard in non tty env ([#114](https://github.com/PostHog/wizard/issues/114)) ([e588d96](https://github.com/PostHog/wizard/commit/e588d96743469ac6176b174e33ade51875e6c8dd))

## [1.9.0](https://github.com/PostHog/wizard/compare/v1.8.7...v1.9.0) (2025-07-29)


### Features

* Event setup mode ([#94](https://github.com/PostHog/wizard/issues/94)) ([c412501](https://github.com/PostHog/wizard/commit/c4125016b257d9b25ce5f95f8d4d8262324ce2d7))

## [1.8.7](https://github.com/PostHog/wizard/compare/v1.8.5...v1.8.7) (2025-07-25)


### Bug Fixes

* don't import mock server in prod ([#109](https://github.com/PostHog/wizard/issues/109)) ([8601e3c](https://github.com/PostHog/wizard/commit/8601e3c824a27a6c7cefc87ac7787cbae80d6815))


### Miscellaneous Chores

* release 1.8.7 ([a7e175d](https://github.com/PostHog/wizard/commit/a7e175d74831f9f438d4a16c985dc9a0911b1c57))

## [1.8.5](https://github.com/PostHog/wizard/compare/v1.8.2...v1.8.3) (2025-07-25)


### Bug Fixes

* don't import e2e tests ([#107](https://github.com/PostHog/wizard/issues/107)) ([7818f18](https://github.com/PostHog/wizard/commit/7818f1857d5c38940370aacbbb8e1ab0165a779c))

## [1.8.1](https://github.com/PostHog/wizard/compare/v1.8.0...v1.8.1) (2025-07-15)


### Bug Fixes

* capture query errors explicitely ([#100](https://github.com/PostHog/wizard/issues/100)) ([e0e860a](https://github.com/PostHog/wizard/commit/e0e860ae02d79318250361939dea666da7d55040))
* getting terminal width ([#98](https://github.com/PostHog/wizard/issues/98)) ([d2a1346](https://github.com/PostHog/wizard/commit/d2a134610746e303be8b5a8a1bda4f890ee8299a))

## [1.8.0](https://github.com/PostHog/wizard/compare/v1.7.1...v1.8.0) (2025-07-11)


### Features

* support gemini models for generation ([#95](https://github.com/PostHog/wizard/issues/95)) ([97934e2](https://github.com/PostHog/wizard/commit/97934e251d45b6fd3b3349deee61f0701e7a83c0))

## [1.7.1](https://github.com/PostHog/wizard/compare/v1.7.0...v1.7.1) (2025-07-10)


### Bug Fixes

* track exception properties correctly ([#92](https://github.com/PostHog/wizard/issues/92)) ([c817db7](https://github.com/PostHog/wizard/commit/c817db7278ea67d1c363b0849be9c0524aefdfbf))

## [1.7.0](https://github.com/PostHog/wizard/compare/v1.6.2...v1.7.0) (2025-07-09)


### Features

* track uncaught errors in the wizard ([#89](https://github.com/PostHog/wizard/issues/89)) ([005d534](https://github.com/PostHog/wizard/commit/005d5344325f0b33e6d5d6d2a71f21b2c6d14683))

## [1.6.2](https://github.com/PostHog/wizard/compare/v1.6.1...v1.6.2) (2025-07-09)


### Bug Fixes

* drop --eu flag ([#87](https://github.com/PostHog/wizard/issues/87)) ([55dee68](https://github.com/PostHog/wizard/commit/55dee68794ca114c176fdc7335cc0378db72a3d6))

## [1.6.1](https://github.com/PostHog/wizard/compare/v1.6.0...v1.6.1) (2025-07-08)


### Bug Fixes

* always ask for dirty repo ([#84](https://github.com/PostHog/wizard/issues/84)) ([9657f35](https://github.com/PostHog/wizard/commit/9657f35d7d23ad374283e66242903d59163c7182))
* handle React 19 legacy peer deps ([#85](https://github.com/PostHog/wizard/issues/85)) ([ddd77a1](https://github.com/PostHog/wizard/commit/ddd77a1887e0acf04e353981a96509d91ae64175))

## [1.6.0](https://github.com/PostHog/wizard/compare/v1.5.3...v1.6.0) (2025-07-08)


### Features

* allow package manager selection in ambiguous environment ([#82](https://github.com/PostHog/wizard/issues/82)) ([82c1ace](https://github.com/PostHog/wizard/commit/82c1ace0ef14f7729068a235409c0c754d00c735))
* make --default the default, and add an --eu flag to make things simpler ([#81](https://github.com/PostHog/wizard/issues/81)) ([3904f4f](https://github.com/PostHog/wizard/commit/3904f4f9e85824ba128a90c07a5888b72805ef2a))

## [1.5.3](https://github.com/PostHog/wizard/compare/v1.5.2...v1.5.3) (2025-07-03)


### Bug Fixes

* remove pr comment at end of workflow ([#79](https://github.com/PostHog/wizard/issues/79)) ([a858f5b](https://github.com/PostHog/wizard/commit/a858f5bb859545b7020d4f1ed8b88e5972878a22))

## [1.5.2](https://github.com/PostHog/wizard/compare/v1.4.0...v1.5.2) (2025-06-30)


### Bug Fixes

* be explicit about defaults in docs ([#77](https://github.com/PostHog/wizard/issues/77)) ([9f33e53](https://github.com/PostHog/wizard/commit/9f33e53d4db2e7c1e32a0e7b517b5996ee0ceed3))
* remove router import ([#75](https://github.com/PostHog/wizard/issues/75)) ([1fc8872](https://github.com/PostHog/wizard/commit/1fc8872581809614dab05cb2db84663aad1a447f))

## [1.4.0](https://github.com/PostHog/wizard/compare/v1.3.1...v1.4.0) (2025-06-25)


### Features

* add Astro support to PostHog Wizard ([#67](https://github.com/PostHog/wizard/issues/67)) ([7d28b6a](https://github.com/PostHog/wizard/commit/7d28b6ab5b5da2c756107b4f06c064010af586c6))

## [1.3.1](https://github.com/PostHog/wizard/compare/v1.3.0...v1.3.1) (2025-06-23)


### Bug Fixes

* package not installed tracked twice ([#66](https://github.com/PostHog/wizard/issues/66)) ([31fe452](https://github.com/PostHog/wizard/commit/31fe45221d2d5354fec50125d554652dbba95bbb))
* supported client detection ([#68](https://github.com/PostHog/wizard/issues/68)) ([60a96b1](https://github.com/PostHog/wizard/commit/60a96b1669e10a0aa74f21d69faa2d400d3db495))

## [1.3.0](https://github.com/PostHog/wizard/compare/v1.2.2...v1.3.0) (2025-06-06)


### Features

* next instrumentation ([#59](https://github.com/PostHog/wizard/issues/59)) ([a6114bd](https://github.com/PostHog/wizard/commit/a6114bd54698fcfa5b2953882bc1f0548ee75115))

## [1.2.2](https://github.com/PostHog/wizard/compare/v1.2.1...v1.2.2) (2025-06-02)


### Bug Fixes

* remove parsing from mcp configs ([#56](https://github.com/PostHog/wizard/issues/56)) ([e89d75a](https://github.com/PostHog/wizard/commit/e89d75a9ab4daf3729c8472214694646ee8aca16))

## [1.2.1](https://github.com/PostHog/wizard/compare/v1.2.0...v1.2.1) (2025-06-02)


### Bug Fixes

* do not suggest mcp installation for EU cloud users ([#54](https://github.com/PostHog/wizard/issues/54)) ([e3010d8](https://github.com/PostHog/wizard/commit/e3010d82f486d2be06e07ca2a282aa7ebaffd640))

## [1.2.0](https://github.com/PostHog/wizard/compare/v1.1.0...v1.2.0) (2025-06-02)


### Features

* setup mcp server automatically on install ([#48](https://github.com/PostHog/wizard/issues/48)) ([0b6b0b5](https://github.com/PostHog/wizard/commit/0b6b0b5414d0c66c248cea49f313589a94eefe09))

## [1.1.0](https://github.com/PostHog/wizard/compare/v1.0.0...v1.1.0) (2025-05-21)


### Features

* enable exception autocapture for all users ([#39](https://github.com/PostHog/wizard/issues/39)) ([0605bbd](https://github.com/PostHog/wizard/commit/0605bbd14cc11d8383005d9d9cd78380cb7347fa))

## 1.0.0 (2025-05-16)


### Features

* add --signup flag for new users ([#19](https://github.com/PostHog/wizard/issues/19)) ([09b4ca8](https://github.com/PostHog/wizard/commit/09b4ca888d9d3bd8402e64baea711ff54e15918a))
* allow install dir as a param ([b1db800](https://github.com/PostHog/wizard/commit/b1db80044140e4584794b31b3c54355a0224f272))
* allow install dir as a param ([55a326a](https://github.com/PostHog/wizard/commit/55a326a05b760fdb32b08fe2324bced529abb5eb))
* analytics for the wizard ([70777c0](https://github.com/PostHog/wizard/commit/70777c0ea0d559218ed0ad350c9fea2395f89d82))
* detect env var prefix + imports in react ([#13](https://github.com/PostHog/wizard/issues/13)) ([2f5e29d](https://github.com/PostHog/wizard/commit/2f5e29d6779d67576a86d668e874b34ba5944bb1))
* posthog analytics setup ([4ee3719](https://github.com/PostHog/wizard/commit/4ee3719a336f0f23689124b496f79d22cb3ba112))
* react support ([1140189](https://github.com/PostHog/wizard/commit/1140189acfb78c139e6f242152b46abb3dca5a8f))
* **react-native:** react native wizard ([#18](https://github.com/PostHog/wizard/issues/18)) ([2a704f7](https://github.com/PostHog/wizard/commit/2a704f71b3e1407715037f7ab5126bb796b80453))
* reverse proxy, get host from api ([307cd12](https://github.com/PostHog/wizard/commit/307cd121919f2c0d8a09ea6258a120fbe9e371f3))
* support install dir env var ([e02f04c](https://github.com/PostHog/wizard/commit/e02f04c1ff1fde6ce4c0f224bab87a10e4efdf2f))
* **svelte:** add svelte support ([#16](https://github.com/PostHog/wizard/issues/16)) ([75822a0](https://github.com/PostHog/wizard/commit/75822a0a09f545170559ff835b4cdbaf9498d770))
* uploading env vars to an external provider ([#32](https://github.com/PostHog/wizard/issues/32)) ([b99e4b2](https://github.com/PostHog/wizard/commit/b99e4b2d55a137b6181c9149ed25cb9fefb42cc1))
* use temporary hash to auth, add prettier formatting ([65f6cca](https://github.com/PostHog/wizard/commit/65f6ccab5ccd09081089d300525dc1e698e84453))
* **wip:** add core openai setup for nextjs ([2819694](https://github.com/PostHog/wizard/commit/281969439b585f9a878927f960f979cf7d2b529d))
* **wip:** auth login ([4b11ead](https://github.com/PostHog/wizard/commit/4b11ead684db1fb59c2471dff50171121cd35dd9))
* **wip:** initial setup ([aed6d6f](https://github.com/PostHog/wizard/commit/aed6d6f90e090376d8f0d3bb1470222be1ffbe50))
* **wip:** login with posthog ([6cf2133](https://github.com/PostHog/wizard/commit/6cf2133f89fde192498990ecbd58135545d763c5))
* **wip:** pull out nextjs internals ([e5cd0bf](https://github.com/PostHog/wizard/commit/e5cd0bfb1c61edb777b7ceb730ecefe59f0f787e))
* **wip:** pulling out nextjs ([ae72ffd](https://github.com/PostHog/wizard/commit/ae72ffd77a5972a5a3a5f295a035289c9eb8e012))
* **wip:** react setup ([7fb1d34](https://github.com/PostHog/wizard/commit/7fb1d34b01e94b5dcf0923ab3c9d6e12bd0a18a5))
* **wip:** react support ([009cc5a](https://github.com/PostHog/wizard/commit/009cc5af9c506cc05b02ed4af874a720eff5cce7))
* workflow for modifying files ([f7616d5](https://github.com/PostHog/wizard/commit/f7616d54784ed1d295bec5e1bcb86fd444160334))


### Bug Fixes

* add back some changes from merge ([658483a](https://github.com/PostHog/wizard/commit/658483a25cafe42670a8093f78c2665aea529f96))
* add env vars if they don't exist ([3d4c92f](https://github.com/PostHog/wizard/commit/3d4c92f9634a25b30d3f096729c32591b9b42fb6))
* add react option when not detected ([c318d6e](https://github.com/PostHog/wizard/commit/c318d6ea53c23c7e208d97cdcc1252176351dd6b))
* add react option when not detected ([8fec618](https://github.com/PostHog/wizard/commit/8fec61888b9ecf8b535124ffac079d2b2fc90f76))
* add shutdown ([587207d](https://github.com/PostHog/wizard/commit/587207dee635877b6a76fd162e84c1c59cb94557))
* always add env vars, remove posthog-js and posthog-node from pages example app ([901bc9d](https://github.com/PostHog/wizard/commit/901bc9dd240742114cd3d5a9812363d709b3fa30))
* ask for eu cloud ([5fde909](https://github.com/PostHog/wizard/commit/5fde909287d1114f5fc888051009c888f264a2d5))
* ask for eu cloud ([c84610a](https://github.com/PostHog/wizard/commit/c84610a3bf189256104445da57ac0705a170b811))
* bump version ([b8ef000](https://github.com/PostHog/wizard/commit/b8ef000ae4a330c5d756ae80d0001a32683ad0df))
* do not choose cloud region on default ([57ac2ca](https://github.com/PostHog/wizard/commit/57ac2ca77213ff779ded52f713b2725e6ecfa9ef))
* move cloud region prompt location ([cfd6be1](https://github.com/PostHog/wizard/commit/cfd6be1c64963e315626ca5548366724e55babc5))
* remove dotenv ([51b7f6d](https://github.com/PostHog/wizard/commit/51b7f6dc018f6cdc09d5fb5462f094bf4b933258))
* remove newline char for vercel ([#36](https://github.com/PostHog/wizard/issues/36)) ([ef8f862](https://github.com/PostHog/wizard/commit/ef8f862aca082d2ab396219d5a582e1cc858b5e4))
* remove package version detection which is pulling from local app ([6eaf704](https://github.com/PostHog/wizard/commit/6eaf704671ff86ff49bdb105ae9308a55008933f))
* remove version from nextjs wizard ([c36694c](https://github.com/PostHog/wizard/commit/c36694cea5b2b7639e6d1e101a245481b12f4517))
* run prettier ([b02f032](https://github.com/PostHog/wizard/commit/b02f0320387730bc4304c9b7a2f118e6b81c470a))
* some linting changes ([f09b267](https://github.com/PostHog/wizard/commit/f09b2676ffd1be8443052a9c1af7ff347e333e31))
* typo ([cadc991](https://github.com/PostHog/wizard/commit/cadc991b9f0f08641a65680fc77a25b071620d4a))
* typo in nextjs wizard success state ([1dacb3b](https://github.com/PostHog/wizard/commit/1dacb3bcdb7cccb065c9ccd69cf7f29a85c51648))
* typo in nextjs wizard success state ([84eccba](https://github.com/PostHog/wizard/commit/84eccbab81cf60e4d877a3414d1ff6f2dcf19705))
* update bin in package.json ([3cf2b25](https://github.com/PostHog/wizard/commit/3cf2b250938ae42c65160ddf1b41e7db6c825e53))
* update docs ([22896e8](https://github.com/PostHog/wizard/commit/22896e8f4acad8067f104217014e30ec24833820))
* update nextjs pages docs ([41f868b](https://github.com/PostHog/wizard/commit/41f868bfea34984e07a028d0ebe6c35c440524b6))
* use internal-t host url ([3bb626b](https://github.com/PostHog/wizard/commit/3bb626ba34b5b0ae20cce170ca0ff371c3eeee2f))
* use wizard hash in headers to get data ([de3fdfe](https://github.com/PostHog/wizard/commit/de3fdfe82a8b92896b2e700d3a5b2995463fe88e))

## Changelog
