# Changelog

## [2.46.0](https://github.com/PostHog/wizard/compare/v2.45.0...v2.46.0) (2026-07-21)


### Features

* automate Android source-map (mapping) upload ([#931](https://github.com/PostHog/wizard/issues/931)) ([b83c23c](https://github.com/PostHog/wizard/commit/b83c23c7dfec8414a068c966ae75ade41328906f))
* **data-warehouse:** expand warehouse-source detection registry ([#930](https://github.com/PostHog/wizard/issues/930)) ([ef41560](https://github.com/PostHog/wizard/commit/ef41560406b82fea69ebce28b1dc8e20b8968ba4))
* **mcp:** OpenCode as a target for wizard installation ([#913](https://github.com/PostHog/wizard/issues/913)) ([27ec6ac](https://github.com/PostHog/wizard/commit/27ec6ac88a3d0eb728196c271bdba379e6263637))
* support iOS source-map uploads ([#871](https://github.com/PostHog/wizard/issues/871)) ([4430ed2](https://github.com/PostHog/wizard/commit/4430ed2920c8157c5714ad5112b4d6358313671d))
* **switchboard:** Self-driving on GPT 5.6 ([#902](https://github.com/PostHog/wizard/issues/902)) ([4a072a2](https://github.com/PostHog/wizard/commit/4a072a2c1662c3524346b4451c52451c213ae350))
* **warehouse:** detect connectable data sources and suggest warehouse setup ([#927](https://github.com/PostHog/wizard/issues/927)) ([e7e651f](https://github.com/PostHog/wizard/commit/e7e651f6dd25f0e476342b18dc971b2c41bd3eea))


### Bug Fixes

* **auth:** read posthog_region from the OAuth token response ([#934](https://github.com/PostHog/wizard/issues/934)) ([ecd4c07](https://github.com/PostHog/wizard/commit/ecd4c07463e1a08950d19e4e53be7a2ac6400893))
* **oauth:** request event definition write scope ([#914](https://github.com/PostHog/wizard/issues/914)) ([1474bc7](https://github.com/PostHog/wizard/commit/1474bc769e53e747f60f993b848c48c4adfa9733))
* **pi:** terminate on critical/block YARA matches only ([#937](https://github.com/PostHog/wizard/issues/937)) ([757a7b2](https://github.com/PostHog/wizard/commit/757a7b2027918301a5320cb5f102ea40a1984717))

## [2.45.0](https://github.com/PostHog/wizard/compare/v2.44.0...v2.45.0) (2026-07-16)


### Features

* add Kotlin Multiplatform (KMP) framework support ([#906](https://github.com/PostHog/wizard/issues/906)) ([983dbe0](https://github.com/PostHog/wizard/commit/983dbe0a6c6da64547d1df80a002762203a68ff3))
* **headless:** agentic monorepo detection behind basic-integration-agentic-detection flag ([#884](https://github.com/PostHog/wizard/issues/884)) ([b153327](https://github.com/PostHog/wizard/commit/b153327f8cfa0287c0b4f3b79a78ba3363414f23))
* **orchestrator:** install step-skills from a per-group bundle ([#911](https://github.com/PostHog/wizard/issues/911)) ([c02199a](https://github.com/PostHog/wizard/commit/c02199ae8eb598c7239efc68936830e928176768))
* **pi:** orchestrator runTask — per-task pi sessions with in-process queue tools ([#853](https://github.com/PostHog/wizard/issues/853)) ([da2706e](https://github.com/PostHog/wizard/commit/da2706e09bfd4e13cffdf8c95553531bb6e56c06))


### Bug Fixes

* **fence:** exact per-manager bash allowlist with agent feedback ([#888](https://github.com/PostHog/wizard/issues/888)) ([#892](https://github.com/PostHog/wizard/issues/892)) ([d9c016d](https://github.com/PostHog/wizard/commit/d9c016dcc2df313f26039a62ea51c8732802097e))
* upload event plans in headless runs ([#891](https://github.com/PostHog/wizard/issues/891)) ([dcaf90f](https://github.com/PostHog/wizard/commit/dcaf90f65a46d9afa83f3339b9ceb34b829ddd9e))

## [2.44.0](https://github.com/PostHog/wizard/compare/v2.43.0...v2.44.0) (2026-07-15)


### Features

* **cli:** honor headless flag in family/native command dispatch ([#893](https://github.com/PostHog/wizard/issues/893)) ([84695ed](https://github.com/PostHog/wizard/commit/84695edef14fb16ce339f602d79a6cc33bf957fd))
* **cli:** scope headless flag to base integration + audit ([#905](https://github.com/PostHog/wizard/issues/905)) ([a99c5f2](https://github.com/PostHog/wizard/commit/a99c5f2e247eeccffd4dd0b510a34f4ed054767c))
* **self-driving:** attribute self-driving sources as created_via=self_driving ([#899](https://github.com/PostHog/wizard/issues/899)) ([7dbd53f](https://github.com/PostHog/wizard/commit/7dbd53f38d1e06a0fa708ab60a8eaf50ddfaeddc))
* **self-driving:** provision an account when no PostHog is found ([#774](https://github.com/PostHog/wizard/issues/774)) ([6483fb0](https://github.com/PostHog/wizard/commit/6483fb0cabc5c031873f7f83c4b34559c72bc551))


### Bug Fixes

* **auth:** copy-link key + narrow-terminal guard on the OAuth screen ([#839](https://github.com/PostHog/wizard/issues/839)) ([139bda8](https://github.com/PostHog/wizard/commit/139bda8d80781136345f216db95e2c11269a5302))

## [2.43.0](https://github.com/PostHog/wizard/compare/v2.42.0...v2.43.0) (2026-07-14)


### Features

* **self-driving:** default to the single connected repo for GitHub Issues ([#878](https://github.com/PostHog/wizard/issues/878)) ([93b5d87](https://github.com/PostHog/wizard/commit/93b5d8734c7f463930b8b3588745017c9601986f))
* **self-driving:** ground custom-scout gap analysis in for-agents context ([#876](https://github.com/PostHog/wizard/issues/876)) ([3ddf98e](https://github.com/PostHog/wizard/commit/3ddf98ecd590c0dfc40f8b37c44818a79db50606))
* **self-driving:** show PR pricing in the learn deck, tips and outro ([#875](https://github.com/PostHog/wizard/issues/875)) ([bdfff61](https://github.com/PostHog/wizard/commit/bdfff610ce4a8f116f72883d007e86e43bd6eedd))
* surface the notebook link in the integration outro ([#882](https://github.com/PostHog/wizard/issues/882)) ([6c2656d](https://github.com/PostHog/wizard/commit/6c2656daa8aab62ef9cd8d146dacd166bdfebab5))
* **switchboard:** add gpt-5.6 line + gpt-5.5 as pi model options, and a pi anti-reformat guard ([#886](https://github.com/PostHog/wizard/issues/886)) ([75a3438](https://github.com/PostHog/wizard/commit/75a3438b0b6da6096e9755230b416bf94e4bea61))


### Bug Fixes

* **warehouse:** unblock wizard_ask after a timed-out prompt ([#872](https://github.com/PostHog/wizard/issues/872)) ([c4d2f30](https://github.com/PostHog/wizard/commit/c4d2f3043af1caf5d691a1d706bd514000d5d007))

## [2.42.0](https://github.com/PostHog/wizard/compare/v2.41.0...v2.42.0) (2026-07-13)


### Features

* **warehouse:** close warehouse-source telemetry gaps ([#873](https://github.com/PostHog/wizard/issues/873)) ([fdafff8](https://github.com/PostHog/wizard/commit/fdafff85ff5efa5c333f55ece8fee42afe901583))


### Bug Fixes

* **ci:** only advertise CI-capable app categories in the wizard-ci menu ([#867](https://github.com/PostHog/wizard/issues/867)) ([41f5536](https://github.com/PostHog/wizard/commit/41f5536a1cf051628cd5738b76a7fa62198b386b))
* **mcp:** describe MCP features as PostHog areas, not a tool roster ([#861](https://github.com/PostHog/wizard/issues/861)) ([669431c](https://github.com/PostHog/wizard/commit/669431c3aa0b83d0ac50de2f50f5ce360cd9cdba))
* **pi:** emit real values for prompt placeholders (links + templating) ([#868](https://github.com/PostHog/wizard/issues/868)) ([fae04d2](https://github.com/PostHog/wizard/commit/fae04d23a0ee189cc82ed12a8a8831def3f3a8ec))
* sync Node preflight range with package.json engines ([#854](https://github.com/PostHog/wizard/issues/854)) ([569051b](https://github.com/PostHog/wizard/commit/569051b5a7e1dbe313a55a6808f1ed85027f431b))

## [2.41.0](https://github.com/PostHog/wizard/compare/v2.40.0...v2.41.0) (2026-07-10)


### Features

* switch the wizard's MCP connections to CLI mode ([#858](https://github.com/PostHog/wizard/issues/858)) ([9c3a1c1](https://github.com/PostHog/wizard/commit/9c3a1c1c4b16cb32d57d82f53a5e1e7d634572bd))


### Bug Fixes

* **pi:** allow rm of files inside the working directory ([#834](https://github.com/PostHog/wizard/issues/834)) ([7e030af](https://github.com/PostHog/wizard/commit/7e030af5c2c34460575904222c0701d54cf8c42f))

## [2.40.0](https://github.com/PostHog/wizard/compare/v2.39.0...v2.40.0) (2026-07-09)


### Features

* **e2e-harness:** preserve ANSI color in snapshot frames ([#730](https://github.com/PostHog/wizard/issues/730)) ([406b41d](https://github.com/PostHog/wizard/commit/406b41dcdb605b1aae0f5f88dfd692357d246731))


### Bug Fixes

* **agent:** corrected read-before-write prompt, install_skill capture-and-continue ([#816](https://github.com/PostHog/wizard/issues/816)) ([c12cdb4](https://github.com/PostHog/wizard/commit/c12cdb4cb2c71684aaa387dec7ba613893f0b798))
* **detection:** stop generic Node claiming Vite apps and Android claiming Flutter ([#817](https://github.com/PostHog/wizard/issues/817)) ([f76a176](https://github.com/PostHog/wizard/commit/f76a176dffea88a740934c3938d645c152e83aaf))
* pin wizard-internal MCP connections to tools mode ([#851](https://github.com/PostHog/wizard/issues/851)) ([16759b2](https://github.com/PostHog/wizard/commit/16759b23f15bc73d5d3405eb4a85067f51b47c97))

## [2.39.0](https://github.com/PostHog/wizard/compare/v2.38.2...v2.39.0) (2026-07-08)


### Features

* **analytics:** tag every event with run_surface (cloud/local) ([#831](https://github.com/PostHog/wizard/issues/831)) ([e21add5](https://github.com/PostHog/wizard/commit/e21add5852fea8afeb7f2252a9b18845b157b966))
* **self-driving:** learn deck and copy rewrites ([#819](https://github.com/PostHog/wizard/issues/819)) ([2767689](https://github.com/PostHog/wizard/commit/27676890eb6dd5bfac757cdb969bfa08f369df46))


### Bug Fixes

* **deps:** bump @posthog/warlock to 0.2.3 ([#827](https://github.com/PostHog/wizard/issues/827)) ([2c33885](https://github.com/PostHog/wizard/commit/2c33885145c12280674dddea8a399114be8a41e4))
* **pi:** scan through warlock, delete the resurrected legacy scanner ([#804](https://github.com/PostHog/wizard/issues/804)) ([383ac5d](https://github.com/PostHog/wizard/commit/383ac5dc7f63da21d8127b4b96d12c62af7179f2))
* **skills:** retry skill downloads with backoff ([#814](https://github.com/PostHog/wizard/issues/814)) ([dd943f7](https://github.com/PostHog/wizard/commit/dd943f724e306062f9f65d8ef9ac3cc6488482a7))
* **switchboard:** disable the pi-harness flag on the headless (cloud) path ([#832](https://github.com/PostHog/wizard/issues/832)) ([f28f3f0](https://github.com/PostHog/wizard/commit/f28f3f01f235dbd88276cf37affcc8d75a4b4293))
* **switchboard:** gate the pi harness flag to posthog-integration only ([#824](https://github.com/PostHog/wizard/issues/824)) ([eb5c61e](https://github.com/PostHog/wizard/commit/eb5c61e5bb569a3e46d9510bcf659091da56bb8b))
* **yara:** repeat-block escalation + scan only edit replacement text (stacked on [#804](https://github.com/PostHog/wizard/issues/804)) ([#820](https://github.com/PostHog/wizard/issues/820)) ([2b589ad](https://github.com/PostHog/wizard/commit/2b589ad01bfe5150ffabc68d0644a472261260a1))

## [2.38.2](https://github.com/PostHog/wizard/compare/v2.38.1...v2.38.2) (2026-07-07)


### Bug Fixes

* **self-driving:** detect existing native PostHog installs, offer continue-with-existing ([#803](https://github.com/PostHog/wizard/issues/803)) ([dbe9893](https://github.com/PostHog/wizard/commit/dbe989388aa1b3315f0d70faf05c2626d096b4d5))

## [2.38.1](https://github.com/PostHog/wizard/compare/v2.38.0...v2.38.1) (2026-07-06)


### Bug Fixes

* **agent:** remark dropped when the model echoes the ask ([#806](https://github.com/PostHog/wizard/issues/806)) ([c7db44e](https://github.com/PostHog/wizard/commit/c7db44e4d80eb54e929a694415c750b92c36d5c1))
* **skills:** survive missing unzip and missing temp dir on Windows ([#807](https://github.com/PostHog/wizard/issues/807)) ([2595fc0](https://github.com/PostHog/wizard/commit/2595fc02fb453b592b20a572871957e27c4dc404))

## [2.38.0](https://github.com/PostHog/wizard/compare/v2.37.0...v2.38.0) (2026-07-06)


### Features

* **oauth:** explain OAuth failures with per-code remediation ([#801](https://github.com/PostHog/wizard/issues/801)) ([0434348](https://github.com/PostHog/wizard/commit/0434348d42a33650dbe5cce02097837d086f8581))
* **pi:** real PostHog MCP dashboard, env lockdown, perf parity ([#701](https://github.com/PostHog/wizard/issues/701)) ([9730dfd](https://github.com/PostHog/wizard/commit/9730dfd97cb95b3b74b80e0ee6d4b2d723b0d953))
* **pi:** telemetry parity with anthropic + pi/orchestrator clamp middleware ([#793](https://github.com/PostHog/wizard/issues/793)) ([3aafb51](https://github.com/PostHog/wizard/commit/3aafb515f484d2eb8bc109532689032eda31f38f))
* **tui:** Hidden Ctrl+T HUD showing running/final LLM token cost ([#783](https://github.com/PostHog/wizard/issues/783)) ([b7ef4ba](https://github.com/PostHog/wizard/commit/b7ef4ba7930e7ef7e2614d0ade7e5f461fb36b83))


### Bug Fixes

* **pi:** completion guard + [STATUS]-alongside-tool ([#805](https://github.com/PostHog/wizard/issues/805)) ([4fc86b2](https://github.com/PostHog/wizard/commit/4fc86b2a653e0eb142b6c10bcbb7cfcb18de57c6))
* **tui:** disable crashing Visualizer tab ([#787](https://github.com/PostHog/wizard/issues/787)) ([18bd38e](https://github.com/PostHog/wizard/commit/18bd38eb5a4c09660060256938c1c9b85b5ad4ad))

## [2.37.0](https://github.com/PostHog/wizard/compare/v2.36.0...v2.37.0) (2026-07-01)


### Features

* Allow enabling products from Wizard ([#776](https://github.com/PostHog/wizard/issues/776)) ([198741f](https://github.com/PostHog/wizard/commit/198741ff1c529ce7f53ff8e90ac7c303ba69abd5))


### Bug Fixes

* **warehouse:** don't count cancelled wizard_ask against the per-run cap ([#770](https://github.com/PostHog/wizard/issues/770)) ([9f4b717](https://github.com/PostHog/wizard/commit/9f4b717f8b5f5f6099a5cde2ba0030f92f0016ef))

## [2.36.0](https://github.com/PostHog/wizard/compare/v2.35.0...v2.36.0) (2026-06-30)


### Features

* **self-driving:** integrate first when the project has no PostHog ([#760](https://github.com/PostHog/wizard/issues/760)) ([3049d9c](https://github.com/PostHog/wizard/commit/3049d9c9e0e6e244c14b831181cdce012365fd60))


### Bug Fixes

* Don't stop analytics after integration run inside self-driving ([#771](https://github.com/PostHog/wizard/issues/771)) ([a7fe755](https://github.com/PostHog/wizard/commit/a7fe755d5e793899a54ca62f0e17dda9967908e7))

## [2.35.0](https://github.com/PostHog/wizard/compare/v2.34.0...v2.35.0) (2026-06-30)


### Features

* **auth:** add --base-url to point the wizard at a custom PostHog stack ([#746](https://github.com/PostHog/wizard/issues/746)) ([80b6967](https://github.com/PostHog/wizard/commit/80b69675d1c89d406e094209f97f50065ded10a4))
* **warlock:** explicit security scanner abort copy ([#751](https://github.com/PostHog/wizard/issues/751)) ([a4c6fd1](https://github.com/PostHog/wizard/commit/a4c6fd103a48eb69a1e87cfebeb6ee378f497986))


### Bug Fixes

* **setup:** honor the provided region in CI instead of probing [@me](https://github.com/me) ([#763](https://github.com/PostHog/wizard/issues/763)) ([f9215b3](https://github.com/PostHog/wizard/commit/f9215b37e4956ea83dbf0c94008432c3bf79f845))

## [2.34.0](https://github.com/PostHog/wizard/compare/v2.33.0...v2.34.0) (2026-06-29)


### Features

* **oauth:** honor --project-id on the OAuth login path ([#743](https://github.com/PostHog/wizard/issues/743)) ([48d8362](https://github.com/PostHog/wizard/commit/48d836225aa4ec3e2e565438b467cd078a25cda8))


### Bug Fixes

* **agent:** isolate the agent SDK to PostHog gateway credentials ([#744](https://github.com/PostHog/wizard/issues/744)) ([7848ed0](https://github.com/PostHog/wizard/commit/7848ed05e759f671021f7fc43a3cb6459bd40436))
* **self-driving:** github auth screen ([#741](https://github.com/PostHog/wizard/issues/741)) ([41076b1](https://github.com/PostHog/wizard/commit/41076b157916a338c2b2cfa4319f02a6392e4b3b))

## [2.33.0](https://github.com/PostHog/wizard/compare/v2.32.0...v2.33.0) (2026-06-26)


### Features

* add experimental headless mode for published, non-interactive runs ([#732](https://github.com/PostHog/wizard/issues/732)) ([6a4a48d](https://github.com/PostHog/wizard/commit/6a4a48dc737e5cd1c71a21d1d3f8ae50a9437e39))
* **self-driving:** Simplify step 1 of self-driving Wizard, as we don't need to check FFs anymore ([#739](https://github.com/PostHog/wizard/issues/739)) ([48e4516](https://github.com/PostHog/wizard/commit/48e45168600d9ff4979a62fa21fbc7073a09db54))
* stream wizard run state to PostHog in headless mode ([#734](https://github.com/PostHog/wizard/issues/734)) ([69caa2a](https://github.com/PostHog/wizard/commit/69caa2a02d5d644b84b5977b06dab0718720d8c2))

## [2.32.0](https://github.com/PostHog/wizard/compare/v2.31.0...v2.32.0) (2026-06-25)


### Features

* **commands:** add flat `mcp-analytics` command ([#731](https://github.com/PostHog/wizard/issues/731)) ([de3f487](https://github.com/PostHog/wizard/commit/de3f48729824f6dbf3cf2fc939862b3ce8c2fb77))

## [2.31.0](https://github.com/PostHog/wizard/compare/v2.30.0...v2.31.0) (2026-06-25)


### Features

* **e2e-harness:** drive and snapshot the real wizard TUI ([#702](https://github.com/PostHog/wizard/issues/702)) ([bd875c3](https://github.com/PostHog/wizard/commit/bd875c36b1e1fe1823d0a3a94fa979948a87b34f))
* tag LLM gateway traces with build type ([#727](https://github.com/PostHog/wizard/issues/727)) ([f97c53f](https://github.com/PostHog/wizard/commit/f97c53f9fc23a873df53678d2a7fb42d779c5c47))
* tag LLM gateway traces with program_id and run identifiers ([#726](https://github.com/PostHog/wizard/issues/726)) ([fcdf70f](https://github.com/PostHog/wizard/commit/fcdf70faa9c390540664c895b28cf9654b65fd5d))

## [2.30.0](https://github.com/PostHog/wizard/compare/v2.29.0...v2.30.0) (2026-06-23)


### Features

* Track steps progression for Wizard. ([#718](https://github.com/PostHog/wizard/issues/718)) ([896f190](https://github.com/PostHog/wizard/commit/896f190d6ddc73f2c7d5381f53f01bc001698116))

## [2.29.0](https://github.com/PostHog/wizard/compare/v2.28.1...v2.29.0) (2026-06-23)


### Features

* agentic detection for source-map upload flow ([#689](https://github.com/PostHog/wizard/issues/689)) ([940bf67](https://github.com/PostHog/wizard/commit/940bf6791e80b54eb4964baa41b88f0e6742ca9e))
* detect more data warehouse sources in onboarding ([#711](https://github.com/PostHog/wizard/issues/711)) ([b206169](https://github.com/PostHog/wizard/commit/b20616915158813f41ee7c9f0c0abc15386ea532))


### Bug Fixes

* **analytics:** tag every event with program_id ([#714](https://github.com/PostHog/wizard/issues/714)) ([4db5a0f](https://github.com/PostHog/wizard/commit/4db5a0f7aa84a4daa86e70789f592adc6c5563d3))
* **self-driving:** Rename "canonical" scouts to "built-in" in self-driving prompt ([#717](https://github.com/PostHog/wizard/issues/717)) ([e99450e](https://github.com/PostHog/wizard/commit/e99450e82951f1a5237f7fd75e9ebe9d981152e8))

## [2.28.1](https://github.com/PostHog/wizard/compare/v2.28.0...v2.28.1) (2026-06-23)


### Bug Fixes

* **self-driving:** Differentiate the source vs scout tips, rename "fleet" to "troop" ([#712](https://github.com/PostHog/wizard/issues/712)) ([edacabc](https://github.com/PostHog/wizard/commit/edacabc57660f1f4944a0c1cecdfa52f5f88986a))

## [2.28.0](https://github.com/PostHog/wizard/compare/v2.27.0...v2.28.0) (2026-06-23)


### Features

* **signals:** Add limits on scouts. ([#707](https://github.com/PostHog/wizard/issues/707)) ([06307d9](https://github.com/PostHog/wizard/commit/06307d9b03018a73f5716adf056eef592804eb60))

## [2.27.0](https://github.com/PostHog/wizard/compare/v2.26.0...v2.27.0) (2026-06-22)


### Features

* detect and connect data warehouse sources ([#488](https://github.com/PostHog/wizard/issues/488)) ([4528780](https://github.com/PostHog/wizard/commit/452878016f8dc5bdca7a7be3d55946a0dfa03006))


### Bug Fixes

* Update readme ([#705](https://github.com/PostHog/wizard/issues/705)) ([cc58dda](https://github.com/PostHog/wizard/commit/cc58ddaf63566adcbc8dad1212d1c925378e36d6))

## [2.26.0](https://github.com/PostHog/wizard/compare/v2.25.0...v2.26.0) (2026-06-22)


### Features

* **self-driving:** Add the `self-driving` program to set up PostHog Self-driving ([#642](https://github.com/PostHog/wizard/issues/642)) ([b834e5d](https://github.com/PostHog/wizard/commit/b834e5d7fe2b964cc8d372b9ce32dd3a1bdba9d2))
* **tui:** multi-select confirm button + space/enter to toggle ([#507](https://github.com/PostHog/wizard/issues/507)) ([8395fb1](https://github.com/PostHog/wizard/commit/8395fb1cc3ff3fbfda7f5293d2a6350800735fbf))
* WizardAmp ([#514](https://github.com/PostHog/wizard/issues/514)) ([5c51b33](https://github.com/PostHog/wizard/commit/5c51b333369d471838e7d1799c6af86e0c932a37))

## [2.25.0](https://github.com/PostHog/wizard/compare/v2.24.1...v2.25.0) (2026-06-18)


### Features

* **cli:** add `wizard cli add` to install agent steering instructions ([#646](https://github.com/PostHog/wizard/issues/646)) ([9819d67](https://github.com/PostHog/wizard/commit/9819d6712c467546b96d5f0cde2f4ad57c692600))
* **orchestrator:** experimental task-queue orchestrator (behind wizard-orchestrator flag) ([#606](https://github.com/PostHog/wizard/issues/606)) ([b4deb24](https://github.com/PostHog/wizard/commit/b4deb24fc64f88072d3685957adf640c9a14364d))


### Bug Fixes

* **cli:** install PostHog CLI before steering ([#687](https://github.com/PostHog/wizard/issues/687)) ([703341a](https://github.com/PostHog/wizard/commit/703341a6a96deaab3220ec8340840e0fb5d49371))

## [2.24.1](https://github.com/PostHog/wizard/compare/v2.24.0...v2.24.1) (2026-06-17)


### Bug Fixes

* separate login and slackconnect screen ([#681](https://github.com/PostHog/wizard/issues/681)) ([5fd0de6](https://github.com/PostHog/wizard/commit/5fd0de69dc92a39285727537f7dc435d4753797a))

## [2.24.0](https://github.com/PostHog/wizard/compare/v2.23.0...v2.24.0) (2026-06-17)


### Features

* **cli:** overhaul cli ([#617](https://github.com/PostHog/wizard/issues/617)) ([413f88e](https://github.com/PostHog/wizard/commit/413f88e33ae1d57c463aa6a11809c234b6b40697))

## [2.23.0](https://github.com/PostHog/wizard/compare/v2.22.1...v2.23.0) (2026-06-16)


### Features

* **analytics:** add run_id to every event and $session_id after login ([#661](https://github.com/PostHog/wizard/issues/661)) ([001925f](https://github.com/PostHog/wizard/commit/001925ff017e5acd431bcc8d2d05c9ac039f9aa3))
* **analytics:** instrument privacy panel, intro menu, and settings-conflict screens ([#666](https://github.com/PostHog/wizard/issues/666)) ([f0decaf](https://github.com/PostHog/wizard/commit/f0decaf23d4a971efd5a78ee7cbeead96ae22872))


### Bug Fixes

* point Slack setup at new /integrations/slack landing page ([#676](https://github.com/PostHog/wizard/issues/676)) ([0b3738c](https://github.com/PostHog/wizard/commit/0b3738c9707e752380a45dc4ada566b7947b8c1e))

## [2.22.1](https://github.com/PostHog/wizard/compare/v2.22.0...v2.22.1) (2026-06-16)


### Bug Fixes

* **agent:** don't fail a successful run on a post-completion socket close ([#662](https://github.com/PostHog/wizard/issues/662)) ([ae606f1](https://github.com/PostHog/wizard/commit/ae606f1cb073f5e255637550a4bafcc16d68b959))
* health-check-retry ([#671](https://github.com/PostHog/wizard/issues/671)) ([cbb64b1](https://github.com/PostHog/wizard/commit/cbb64b1004f6fba600a81008c666f87d70d2c752))

## [2.22.0](https://github.com/PostHog/wizard/compare/v2.21.0...v2.22.0) (2026-06-15)


### Features

* **privacy:** consolidate disclosure into Privacy & data usage panel ([#644](https://github.com/PostHog/wizard/issues/644)) ([d5273d4](https://github.com/PostHog/wizard/commit/d5273d4b464e5be19577574565de99f459fe236f))
* **privacy:** gate runs on AI opt in org setting ([#645](https://github.com/PostHog/wizard/issues/645)) ([6cbf743](https://github.com/PostHog/wizard/commit/6cbf7430685a89def019ca965fbbd06178158e9e))
* refresh Slack app copy and update /slack URL ([#659](https://github.com/PostHog/wizard/issues/659)) ([ddeb64a](https://github.com/PostHog/wizard/commit/ddeb64affce02cf285113b4472d8c3424b6bc24b))
* **slack:** relabel Skip to Skip / Continue on the connect screen ([#660](https://github.com/PostHog/wizard/issues/660)) ([9979a32](https://github.com/PostHog/wizard/commit/9979a32ad89f0159aae64550092a88e29302d9ee))
* surface a coding-agent handoff prompt on wizard exit ([#595](https://github.com/PostHog/wizard/issues/595)) ([9762ff3](https://github.com/PostHog/wizard/commit/9762ff3684040b9b361d110b9af9bb0210e52ca2))
* upload source maps CI support ([#651](https://github.com/PostHog/wizard/issues/651)) ([84b7aad](https://github.com/PostHog/wizard/commit/84b7aad5082db4db32818427fa54e489cda9ad89))
* utm-tag and track outbound links, fix event attribution ([#653](https://github.com/PostHog/wizard/issues/653)) ([d927119](https://github.com/PostHog/wizard/commit/d92711914445d67f3be1e2cb332c36c5119011c7))
* wizard slack command ([#654](https://github.com/PostHog/wizard/issues/654)) ([0790389](https://github.com/PostHog/wizard/commit/0790389fbeb9791eaa1b74564dbdde4fadaae94e))


### Bug Fixes

* **oauth:** time out the login flow at 5 minutes and prompt re-run ([#658](https://github.com/PostHog/wizard/issues/658)) ([e0f35da](https://github.com/PostHog/wizard/commit/e0f35da41ef2744999a1ffcc7416a02dc6391128))
* privacy panel for upload-source-maps ([#663](https://github.com/PostHog/wizard/issues/663)) ([a81910c](https://github.com/PostHog/wizard/commit/a81910c2ba3364a429caf4e8bab945dd943ab2d9))

## [2.21.0](https://github.com/PostHog/wizard/compare/v2.20.0...v2.21.0) (2026-06-12)


### Features

* detect existing Slack connection at the end of a wizard run ([#649](https://github.com/PostHog/wizard/issues/649)) ([06bbf79](https://github.com/PostHog/wizard/commit/06bbf794f1cffe1ccea77988a04344b56d65641c))

## [2.20.0](https://github.com/PostHog/wizard/compare/v2.19.0...v2.20.0) (2026-06-12)


### Features

* **agent:** detect all gateway-auth overrides and make the 401 actionable ([#615](https://github.com/PostHog/wizard/issues/615)) ([51e54b8](https://github.com/PostHog/wizard/commit/51e54b8a1c999389f02ae612818c8cb52056d9c2))
* Slack connect follow-ups from [#640](https://github.com/PostHog/wizard/issues/640) review ([#648](https://github.com/PostHog/wizard/issues/648)) ([f5a6f72](https://github.com/PostHog/wizard/commit/f5a6f72d128e772cbbca148a2e5e652b047920f0))
* surface the PostHog Slack app in the MCP tutorial ([#640](https://github.com/PostHog/wizard/issues/640)) ([e9257b8](https://github.com/PostHog/wizard/commit/e9257b88108d4bead72ff2371828a73c99986e6f))


### Bug Fixes

* **agent:** make .claude/settings backup/restore resilient ([#614](https://github.com/PostHog/wizard/issues/614)) ([9c8d27a](https://github.com/PostHog/wizard/commit/9c8d27a09bc8edfb2df76c9ce34b4f1d12dccf84))

## [2.19.0](https://github.com/PostHog/wizard/compare/v2.18.0...v2.19.0) (2026-06-11)


### Features

* **mcp:** granular feature selection with plugin/MCP decoupling ([#442](https://github.com/PostHog/wizard/issues/442)) ([6acf3ee](https://github.com/PostHog/wizard/commit/6acf3ee449f5b7de180b3100cc94fcb14823db7a))


### Bug Fixes

* **wizard:** Fix wizard workbench runs against local MCP/repo ([#641](https://github.com/PostHog/wizard/issues/641)) ([96e4621](https://github.com/PostHog/wizard/commit/96e4621f4d3e63331316824d30b75fce91f7ad35))

## [2.18.0](https://github.com/PostHog/wizard/compare/v2.17.0...v2.18.0) (2026-06-10)


### Features

* Add Web analytics doctor ([#506](https://github.com/PostHog/wizard/issues/506)) ([025ab55](https://github.com/PostHog/wizard/commit/025ab5503b1c7b562fa066a650fbef189506c9d3))
* attach PostHog groups to wizard analytics events ([#591](https://github.com/PostHog/wizard/issues/591)) ([752c747](https://github.com/PostHog/wizard/commit/752c747bfd7558376a30c77fc5af169361b475b8))
* **cli:** replace --skill flag with skill command ([#618](https://github.com/PostHog/wizard/issues/618)) ([424bd51](https://github.com/PostHog/wizard/commit/424bd519bb43a4c7a524df18bdf5ad539c2c8d2d))


### Bug Fixes

* Bound the two uncapped in-memory buffers in the agent run ([#516](https://github.com/PostHog/wizard/issues/516)) ([4f59877](https://github.com/PostHog/wizard/commit/4f59877ac0a3de8d79020e872dda4f7633cb0b47))
* ff scopes for agent skill program ([#604](https://github.com/PostHog/wizard/issues/604)) ([7f0ee00](https://github.com/PostHog/wizard/commit/7f0ee00562835ca63a8f41105d17b057e7c22fb0))
* upload source maps command ([#630](https://github.com/PostHog/wizard/issues/630)) ([23714b3](https://github.com/PostHog/wizard/commit/23714b309d272477e505b0ca6dcb09b2b6f4dd0d))

## [2.17.0](https://github.com/PostHog/wizard/compare/v2.16.1...v2.17.0) (2026-06-05)


### Features

* **mcp:** add Claude Desktop/Web to mcp add ([#517](https://github.com/PostHog/wizard/issues/517)) ([501e55a](https://github.com/PostHog/wizard/commit/501e55a0150fee7a926e91044378cd952a359fd4))
* role-aware MCP tutorial with dialogue follow-ups and goodbye ([#508](https://github.com/PostHog/wizard/issues/508)) ([0c84e2f](https://github.com/PostHog/wizard/commit/0c84e2f4d21e8372697cce54b454998a0bd2f554))

## [2.16.1](https://github.com/PostHog/wizard/compare/v2.16.0...v2.16.1) (2026-06-05)


### Bug Fixes

* make seeded audit ledger customizable ([#512](https://github.com/PostHog/wizard/issues/512)) ([2419aa1](https://github.com/PostHog/wizard/commit/2419aa114dcd78f9f6cfc3c8599c318606e83d6f))
* Make the source map deck look less like a real error ([#504](https://github.com/PostHog/wizard/issues/504)) ([5b92daa](https://github.com/PostHog/wizard/commit/5b92daa9368a5c0ff29378976b54258c9743a31a))
* **tui:** keep keyboard hints bar always visible ([#511](https://github.com/PostHog/wizard/issues/511)) ([8711f02](https://github.com/PostHog/wizard/commit/8711f022e00a0cc71a8e7df1f8531449b6b6860e))

## [2.16.0](https://github.com/PostHog/wizard/compare/v2.15.0...v2.16.0) (2026-06-03)


### Features

* Rebuild the MCP install + create role-tailored prompts screen ([#500](https://github.com/PostHog/wizard/issues/500)) ([06ba620](https://github.com/PostHog/wizard/commit/06ba6204b89a3315f9d46a217f8abac2b0c2b00c))

## [2.15.0](https://github.com/PostHog/wizard/compare/v2.14.3...v2.15.0) (2026-06-03)


### Features

* add wizard state push ([#463](https://github.com/PostHog/wizard/issues/463)) ([323a84f](https://github.com/PostHog/wizard/commit/323a84feb9f3bbcd4be9a990b26722ff001d1f42))
* disable --ci in published builds ([#499](https://github.com/PostHog/wizard/issues/499)) ([c34b712](https://github.com/PostHog/wizard/commit/c34b712c3f687f3dfe74d280e3725f0a490dea97))
* enrich oauth login failure telemetry for diagnosis ([#501](https://github.com/PostHog/wizard/issues/501)) ([e70f51b](https://github.com/PostHog/wizard/commit/e70f51b549dee4e5f9fbc487f5667e8a3500d178))
* error tracking source maps ([#475](https://github.com/PostHog/wizard/issues/475)) ([c25b7b8](https://github.com/PostHog/wizard/commit/c25b7b84276c524e2dc5c39ff7b6e211e795fcb9))
* manual OAuth code paste ([#496](https://github.com/PostHog/wizard/issues/496)) ([0e43025](https://github.com/PostHog/wizard/commit/0e43025b0a8f893669ae63ba9a4aab99d53c2eba))


### Bug Fixes

* drop ungrantable `introspection` scope from OAuth authorize URL ([#443](https://github.com/PostHog/wizard/issues/443)) ([69ed45b](https://github.com/PostHog/wizard/commit/69ed45b8fa4bcfb62528fee2900357bcd02b1e95))
* responsive bug that hijacked the authorize url ([#497](https://github.com/PostHog/wizard/issues/497)) ([cdf17a4](https://github.com/PostHog/wizard/commit/cdf17a41a270fbf165a8c1b4d7f1b7d7568ee4ec))

## [2.14.3](https://github.com/PostHog/wizard/compare/v2.14.2...v2.14.3) (2026-06-01)


### Bug Fixes

* sharing health check step with agent-skill program ([#494](https://github.com/PostHog/wizard/issues/494)) ([2b866ad](https://github.com/PostHog/wizard/commit/2b866adb49ef3157ff0d713f5f825ef7c4d03e7e))

## [2.14.2](https://github.com/PostHog/wizard/compare/v2.14.1...v2.14.2) (2026-05-26)


### Bug Fixes

* make refresh token optional for impersonated users ([#483](https://github.com/PostHog/wizard/issues/483)) ([48a55c8](https://github.com/PostHog/wizard/commit/48a55c87adc04e7192670f57dd0142f32df12450))

## [2.14.1](https://github.com/PostHog/wizard/compare/v2.14.0...v2.14.1) (2026-05-26)


### Bug Fixes

* remove shrinkwrap ([#481](https://github.com/PostHog/wizard/issues/481)) ([35f6aea](https://github.com/PostHog/wizard/commit/35f6aea78d605e419ca7715ac44fb25093cf4302))

## [2.14.0](https://github.com/PostHog/wizard/compare/v2.13.1...v2.14.0) (2026-05-26)


### Features

* Events audit ([#449](https://github.com/PostHog/wizard/issues/449)) ([6783b52](https://github.com/PostHog/wizard/commit/6783b52b08f38a3af2534cedba8db089b4531ec8))
* migration agent ([#474](https://github.com/PostHog/wizard/issues/474)) ([7a7dba4](https://github.com/PostHog/wizard/commit/7a7dba4ab6def678003bee5dc74d163984c4b8d4))
* User input overlay ([#459](https://github.com/PostHog/wizard/issues/459)) ([b050c5b](https://github.com/PostHog/wizard/commit/b050c5bbf626cad2aaa40173c56beabdaf9e6360))


### Bug Fixes

* improve CI mode 401 error UX ([#432](https://github.com/PostHog/wizard/issues/432)) ([5fb5790](https://github.com/PostHog/wizard/commit/5fb579077a7fa7bd7688dc90319773aa8a8cc101))
* release ([#480](https://github.com/PostHog/wizard/issues/480)) ([771ffe0](https://github.com/PostHog/wizard/commit/771ffe083ff2c6da11120b847bb5fd06cf27124c))
* smoke test directory ([#473](https://github.com/PostHog/wizard/issues/473)) ([984f1dc](https://github.com/PostHog/wizard/commit/984f1dc092ebb129823065684de3c8d9196fc3a9))
* task queue ([#471](https://github.com/PostHog/wizard/issues/471)) ([5c4622c](https://github.com/PostHog/wizard/commit/5c4622cffdacb4c51e41fa6c7c0929f55d2c80d6))

## [2.13.1](https://github.com/PostHog/wizard/compare/v2.13.0...v2.13.1) (2026-05-14)


### Bug Fixes

* bedrock fallback ([#454](https://github.com/PostHog/wizard/issues/454)) ([66ba2df](https://github.com/PostHog/wizard/commit/66ba2df3b972f0fb416f4092b5b3fa1ae589849b))

## [2.13.0](https://github.com/PostHog/wizard/compare/v2.12.0...v2.13.0) (2026-05-14)


### Features

* add audit-3000 wizard command ([#452](https://github.com/PostHog/wizard/issues/452)) ([8e434f4](https://github.com/PostHog/wizard/commit/8e434f40111ad8347e753b335b379c065501d60b))

## [2.12.0](https://github.com/PostHog/wizard/compare/v2.11.0...v2.12.0) (2026-05-07)


### Features

* Audit ([#425](https://github.com/PostHog/wizard/issues/425)) ([bbd07f9](https://github.com/PostHog/wizard/commit/bbd07f9864e5ea701af4d08f63fce42164185ba6))
* enable AWS Bedrock fallback for wizard agent requests ([#439](https://github.com/PostHog/wizard/issues/439)) ([cbf6b04](https://github.com/PostHog/wizard/commit/cbf6b049666b49784e131ee2ceb595c58cfc4cee))
* headless provision subcommand + --ci --signup for agents ([#415](https://github.com/PostHog/wizard/issues/415)) ([7afca9f](https://github.com/PostHog/wizard/commit/7afca9f40a62b9dc2e3f6d2aac08d3c2963f7a9b))
* open PostHog dashboard after signup ([#398](https://github.com/PostHog/wizard/issues/398)) ([b9a1888](https://github.com/PostHog/wizard/commit/b9a188860ffb310162b183b6dbc3aef2f6429281))


### Bug Fixes

* request llm_gateway:read scope during signup provisioning ([#435](https://github.com/PostHog/wizard/issues/435)) ([4a2d511](https://github.com/PostHog/wizard/commit/4a2d5115e343df79f5c067d16abea0db892f8864))
* skip non-essential health checks for signup and show clear errors on outages ([#413](https://github.com/PostHog/wizard/issues/413)) ([44bac37](https://github.com/PostHog/wizard/commit/44bac37bde1ea0e80e79bbc0a7833d62fd8d73ca))

## [2.11.0](https://github.com/PostHog/wizard/compare/v2.10.4...v2.11.0) (2026-04-30)


### Features

* Add health checks to wizard ([#422](https://github.com/PostHog/wizard/issues/422)) ([55765b7](https://github.com/PostHog/wizard/commit/55765b72e47db07ca6990d1e4aa7ea3b453ef9b1))
* detect LLM usage in Python ([#424](https://github.com/PostHog/wizard/issues/424)) ([38cdfc4](https://github.com/PostHog/wizard/commit/38cdfc42f3a563cf2bcda84eb9f7f4166eab0374))
* messages to the heavens ([#410](https://github.com/PostHog/wizard/issues/410)) ([fe1114a](https://github.com/PostHog/wizard/commit/fe1114a2f6f98add453c73934ff2e2503ea23d4c))


### Bug Fixes

* **mcp:** drop /sse transport, always install /mcp ([#429](https://github.com/PostHog/wizard/issues/429)) ([4fcbf8a](https://github.com/PostHog/wizard/commit/4fcbf8a4933bab5a4cf7068ad3e0a43e5adb650d))
* prevent intro screen squish ([#423](https://github.com/PostHog/wizard/issues/423)) ([8008343](https://github.com/PostHog/wizard/commit/80083438b17244862bc74c22342b3fc95c28fbde))

## [2.10.4](https://github.com/PostHog/wizard/compare/v2.10.3...v2.10.4) (2026-04-24)


### Bug Fixes

* outro/exit clash ([#420](https://github.com/PostHog/wizard/issues/420)) ([17b2c82](https://github.com/PostHog/wizard/commit/17b2c8275a9c68bf6addd535b2f2841cade3e6a3))

## [2.10.3](https://github.com/PostHog/wizard/compare/v2.10.2...v2.10.3) (2026-04-23)


### Bug Fixes

* pass email and region from CLI to session ([#418](https://github.com/PostHog/wizard/issues/418)) ([268c26f](https://github.com/PostHog/wizard/commit/268c26fbdb38528bf3f880497abf4a44e575a8e3))

## [2.10.2](https://github.com/PostHog/wizard/compare/v2.10.1...v2.10.2) (2026-04-23)


### Bug Fixes

* add --email CLI flag for signup provisioning ([#414](https://github.com/PostHog/wizard/issues/414)) ([e324fbe](https://github.com/PostHog/wizard/commit/e324fbe199e01135241c16cb76c85ce014fecca9))

## [2.10.1](https://github.com/PostHog/wizard/compare/v2.10.0...v2.10.1) (2026-04-23)


### Bug Fixes

* pass email and region to provisioning signup flow ([#403](https://github.com/PostHog/wizard/issues/403)) ([2f75cee](https://github.com/PostHog/wizard/commit/2f75cee1ba80bae07ae3795edc1c3087919264ca))
* Remove hacky desktop connection, stand alone mcp install ([#408](https://github.com/PostHog/wizard/issues/408)) ([176b496](https://github.com/PostHog/wizard/commit/176b496e9860bebc28953638085e137738ba2362))

## [2.10.0](https://github.com/PostHog/wizard/compare/v2.9.1...v2.10.0) (2026-04-22)


### Features

* hints for keys ([#404](https://github.com/PostHog/wizard/issues/404)) ([52a9968](https://github.com/PostHog/wizard/commit/52a9968eb89107a178b2a475c89f336e2fa807f8))
* pass org and project names to provisioning API ([#384](https://github.com/PostHog/wizard/issues/384)) ([4f4ae09](https://github.com/PostHog/wizard/commit/4f4ae09120b2dd633c427e2f16b06a3e9327493c))
* use alternate buffer ([#407](https://github.com/PostHog/wizard/issues/407)) ([cd3871e](https://github.com/PostHog/wizard/commit/cd3871e2a7245b270edfcf9462cd515743939fa6))


### Bug Fixes

* add urls to open source repos ([#405](https://github.com/PostHog/wizard/issues/405)) ([569de91](https://github.com/PostHog/wizard/commit/569de91c6180234dd20bef99ed24d01e03d58fcc))
* Backup ports ([#400](https://github.com/PostHog/wizard/issues/400)) ([0a94ae4](https://github.com/PostHog/wizard/commit/0a94ae4e3dfac0da8b6bf1350bc27b33aaead183))
* flickering under very specific conditions ([#406](https://github.com/PostHog/wizard/issues/406)) ([84bddae](https://github.com/PostHog/wizard/commit/84bddaeb963534d2dd15e7a934f28fd9d53a9030))
* We use a different status page now ([#409](https://github.com/PostHog/wizard/issues/409)) ([9c3d3b2](https://github.com/PostHog/wizard/commit/9c3d3b2ca99f76f5672ce4565e9c8cfbc92ac5d1))

## [2.9.1](https://github.com/PostHog/wizard/compare/v2.9.0...v2.9.1) (2026-04-16)


### Bug Fixes

* delete skills ([#391](https://github.com/PostHog/wizard/issues/391)) ([1370547](https://github.com/PostHog/wizard/commit/1370547704801e793c43b64f5d1a076cb2cbcd26))
* MCP input for windows + playground ([#395](https://github.com/PostHog/wizard/issues/395)) ([62e4bf5](https://github.com/PostHog/wizard/commit/62e4bf5c844f86b1769b29893d3383e9276d0087))

## [2.9.0](https://github.com/PostHog/wizard/compare/v2.8.0...v2.9.0) (2026-04-15)


### Features

* agent harness can run arbitrary workflows ([#385](https://github.com/PostHog/wizard/issues/385)) ([34aa648](https://github.com/PostHog/wizard/commit/34aa6483510dd0f4428beef41618d0e4b6e24fc6))

## [2.8.0](https://github.com/PostHog/wizard/compare/v2.7.0...v2.8.0) (2026-04-13)


### Features

* add provisioning API signup flow for new users ([#377](https://github.com/PostHog/wizard/issues/377)) ([c101aeb](https://github.com/PostHog/wizard/commit/c101aeb5a091e3824acaf9f93a4e1d4da1e07c8a))

## [2.7.0](https://github.com/PostHog/wizard/compare/v2.6.2...v2.7.0) (2026-04-08)


### Features

* Ask to remove skills if successful ([#371](https://github.com/PostHog/wizard/issues/371)) ([05c97cc](https://github.com/PostHog/wizard/commit/05c97ccc6c248ff283c166670f9b577218821a02))


### Bug Fixes

* Cloudflare detection and context augmentation ([#370](https://github.com/PostHog/wizard/issues/370)) ([e719244](https://github.com/PostHog/wizard/commit/e719244de8a28bfe56caae97bbe3e681cc4c68e5))
* Group MCP Logs under Development Tools ([#374](https://github.com/PostHog/wizard/issues/374)) ([56ba4c7](https://github.com/PostHog/wizard/commit/56ba4c778527fd5f687fdd942344c4cc360b3f4f))
* wire up readApiKeyFromEnv to session builder ([#363](https://github.com/PostHog/wizard/issues/363)) ([752cb2f](https://github.com/PostHog/wizard/commit/752cb2fe552d4749c3b908831b0877176f6a9a93))

## [2.6.2](https://github.com/PostHog/wizard/compare/v2.6.1...v2.6.2) (2026-04-01)


### Bug Fixes

* Also log abort durations ([#364](https://github.com/PostHog/wizard/issues/364)) ([744a510](https://github.com/PostHog/wizard/commit/744a5109a609e677f852caead0d6c77bd401b153))
* prevent GroupedPickerMenu overflow with scrolling and text truncation ([#365](https://github.com/PostHog/wizard/issues/365)) ([cb0c6b9](https://github.com/PostHog/wizard/commit/cb0c6b94bb5553e875859e00e6b2fd0611929bec))

## [2.6.1](https://github.com/PostHog/wizard/compare/v2.6.0...v2.6.1) (2026-03-31)


### Bug Fixes

* Enable tool search ([#361](https://github.com/PostHog/wizard/issues/361)) ([1745905](https://github.com/PostHog/wizard/commit/17459057291b795cbe03842873f26bf54b28e84b))

## [2.6.0](https://github.com/PostHog/wizard/compare/v2.5.0...v2.6.0) (2026-03-31)


### Features

* support API key from .env for MCP server configuration ([#356](https://github.com/PostHog/wizard/issues/356)) ([4cdf4ba](https://github.com/PostHog/wizard/commit/4cdf4babc385da7a02f5e7d8ef363fc33c024987))

## [2.5.0](https://github.com/PostHog/wizard/compare/v2.4.0...v2.5.0) (2026-03-24)


### Features

* **mcp:** Allowing to specify MCP features ([#350](https://github.com/PostHog/wizard/issues/350)) ([5b3499a](https://github.com/PostHog/wizard/commit/5b3499a22288b8d601379b4db8ba563bdc59b8c8))


### Bug Fixes

* Better node engine pins ([#353](https://github.com/PostHog/wizard/issues/353)) ([86e1878](https://github.com/PostHog/wizard/commit/86e18787badf5732b9cac0c5a16c3f283d8850b3))

## [2.4.0](https://github.com/PostHog/wizard/compare/v2.3.0...v2.4.0) (2026-03-18)


### Features

* Add managed settings screen ([#345](https://github.com/PostHog/wizard/issues/345)) ([b0d3615](https://github.com/PostHog/wizard/commit/b0d36153fcfec52be331d4004e7f8691c53fa7ee))


### Bug Fixes

* Also handle API key helper ([#343](https://github.com/PostHog/wizard/issues/343)) ([3e7ebe7](https://github.com/PostHog/wizard/commit/3e7ebe782136086e346a5b1fe0f8cdbe06e2faf8))
* Handle 401s better ([#346](https://github.com/PostHog/wizard/issues/346)) ([c41418a](https://github.com/PostHog/wizard/commit/c41418a1997a65201e825a998879527987a9b2cd))

## [2.3.0](https://github.com/PostHog/wizard/compare/v2.2.0...v2.3.0) (2026-03-16)


### Features

* If outage, show sensible fallbacks ([#340](https://github.com/PostHog/wizard/issues/340)) ([8bcba83](https://github.com/PostHog/wizard/commit/8bcba83197da1ff7d5a39b1a023707eb67013c6d))


### Bug Fixes

* Skills allow underscore ([#342](https://github.com/PostHog/wizard/issues/342)) ([10a291b](https://github.com/PostHog/wizard/commit/10a291be0f1e72a7df6e74730aab7467ea85eaa6))

## [2.2.0](https://github.com/PostHog/wizard/compare/v2.1.0...v2.2.0) (2026-03-13)


### Features

* Full service warnings ([#336](https://github.com/PostHog/wizard/issues/336)) ([c1e02d1](https://github.com/PostHog/wizard/commit/c1e02d10bff586531e6fd37d4d3ff2f4718f9a2c))
* More aggressive sandboxing https://github.com/PostHog/wizard/pull/339

## [2.1.0](https://github.com/PostHog/wizard/compare/v2.0.2...v2.1.0) (2026-03-12)


### Features

* add YARA scanning ([#305](https://github.com/PostHog/wizard/issues/305)) ([6f4fb52](https://github.com/PostHog/wizard/commit/6f4fb52bbf8bbc05854bbf9d26feb01552da29dc))


### Bug Fixes

* unit tests for package.json semver handling ([#334](https://github.com/PostHog/wizard/issues/334)) ([e60235e](https://github.com/PostHog/wizard/commit/e60235e6ce117ca9bb4e1482f06e28a713599eb9))

## [2.0.2](https://github.com/PostHog/wizard/compare/v2.0.1...v2.0.2) (2026-03-11)


### Bug Fixes

* Handle blocked port, reliably present incompatible version UI, and detect the actual version of a framework ([#332](https://github.com/PostHog/wizard/issues/332)) ([f1cf38c](https://github.com/PostHog/wizard/commit/f1cf38c4497daa6b8c8c11c5462d15d5ca7ac41e))

## [2.0.1](https://github.com/PostHog/wizard/compare/v2.0.0...v2.0.1) (2026-03-10)


### Bug Fixes

* versions ([#330](https://github.com/PostHog/wizard/issues/330)) ([fa61742](https://github.com/PostHog/wizard/commit/fa61742fccb7dc9635ab55dac33862eb34dc54ea))

## [2.0.0](https://github.com/PostHog/wizard/compare/v1.36.1...v2.0.0) (2026-03-10)


### ⚠ BREAKING CHANGES

* Text run screen ([#328](https://github.com/PostHog/wizard/issues/328))

### Features

* Handle analytics ([#289](https://github.com/PostHog/wizard/issues/289)) ([7f8dcba](https://github.com/PostHog/wizard/commit/7f8dcbad9f0e7daf7b5cb97461ff82a3c3067b8c))
* Let's make a nice TUI ([#309](https://github.com/PostHog/wizard/issues/309)) ([b6eced6](https://github.com/PostHog/wizard/commit/b6eced684dcf59a52fd0837bfb5370e828d59256))
* Text run screen ([#328](https://github.com/PostHog/wizard/issues/328)) ([777761b](https://github.com/PostHog/wizard/commit/777761b6b88427c69cbba05e0299c80a1adb7123))
* use native HTTP transport for Codex CLI ([#312](https://github.com/PostHog/wizard/issues/312)) ([c6276b4](https://github.com/PostHog/wizard/commit/c6276b42d9d75754d65b3bd64f699dd4ebe6d08f))


### Bug Fixes

* 401 authentication_error on wizard runs. ([#324](https://github.com/PostHog/wizard/issues/324)) ([3dda544](https://github.com/PostHog/wizard/commit/3dda54452a3d6f6a7457efbb4be0bb4e0563e139))
* JS web detection ([#313](https://github.com/PostHog/wizard/issues/313)) ([5c9948a](https://github.com/PostHog/wizard/commit/5c9948abfb2604770d15c7c222688d6e28f3eac0))

## [1.36.1](https://github.com/PostHog/wizard/compare/v1.36.0...v1.36.1) (2026-03-03)


### Bug Fixes

* remove region selection from MCP setup ([#308](https://github.com/PostHog/wizard/issues/308)) ([776a6d9](https://github.com/PostHog/wizard/commit/776a6d913459ab898b313e939d1f0341f18904f5))

## [1.36.0](https://github.com/PostHog/wizard/compare/v1.35.2...v1.36.0) (2026-03-03)


### Features

* Commandments should be actual commandments ([#306](https://github.com/PostHog/wizard/issues/306)) ([458f68e](https://github.com/PostHog/wizard/commit/458f68e3faa4273ff568b1fed1864970c42e64bd))


### Bug Fixes

* wizard issue notify ([#302](https://github.com/PostHog/wizard/issues/302)) ([8821e8a](https://github.com/PostHog/wizard/commit/8821e8a9f8531eb44b4f7a00286c712143604e05))

## [1.35.2](https://github.com/PostHog/wizard/compare/v1.35.1...v1.35.2) (2026-02-26)


### Bug Fixes

* Fix release link ([#298](https://github.com/PostHog/wizard/issues/298)) ([8ecabff](https://github.com/PostHog/wizard/commit/8ecabffadb162b08df7ac66d32c7ee257e617e31))

## [1.35.1](https://github.com/PostHog/wizard/compare/v1.35.0...v1.35.1) (2026-02-26)


### Bug Fixes

* revert agent sdk ([#294](https://github.com/PostHog/wizard/issues/294)) ([03eea97](https://github.com/PostHog/wizard/commit/03eea971c92d0cdb85c3aeb483c5a85fc5b913a7))

## [1.35.0](https://github.com/PostHog/wizard/compare/v1.34.0...v1.35.0) (2026-02-26)


### Features

* add Node.js skill ([#283](https://github.com/PostHog/wizard/issues/283)) ([12a2a29](https://github.com/PostHog/wizard/commit/12a2a295be31720a291131a9bb4faba7a244c948))
* benchmark tools ([#280](https://github.com/PostHog/wizard/issues/280)) ([0f79a24](https://github.com/PostHog/wizard/commit/0f79a24a7c76c0e11e679c56924cca96731db7eb))
* js-web skill ([#272](https://github.com/PostHog/wizard/issues/272)) ([8435eb9](https://github.com/PostHog/wizard/commit/8435eb97fb05f03528bf45db7c1385fb04dde6b9))
* pass project id ([#285](https://github.com/PostHog/wizard/issues/285)) ([c9d05c9](https://github.com/PostHog/wizard/commit/c9d05c9293448a66b43678afb559b8f859a87434))
* **wizard:** Add User-Agent header to wizard HTTP requests ([#291](https://github.com/PostHog/wizard/issues/291)) ([edae68f](https://github.com/PostHog/wizard/commit/edae68f567986249d149bb0fcd90b9c83ed369b0))

## [1.34.0](https://github.com/PostHog/wizard/compare/v1.33.0...v1.34.0) (2026-02-20)


### Features

* Ruby + Ruby on Rails support ([#276](https://github.com/PostHog/wizard/issues/276)) ([26ac00d](https://github.com/PostHog/wizard/commit/26ac00d3075f5b4704e0479de408e0fe0cc5c32c))

## [1.33.0](https://github.com/PostHog/wizard/compare/v1.32.1...v1.33.0) (2026-02-19)


### Features

* Package manager detection tool ([#277](https://github.com/PostHog/wizard/issues/277)) ([8a6a4af](https://github.com/PostHog/wizard/commit/8a6a4af1ed837892c785307868192410731d3aeb))

## [1.32.1](https://github.com/PostHog/wizard/compare/v1.32.0...v1.32.1) (2026-02-12)


### Bug Fixes

* don't show the entire conversation in error message ([#273](https://github.com/PostHog/wizard/issues/273)) ([1cb52eb](https://github.com/PostHog/wizard/commit/1cb52ebd7dd67f2b2839c65b2920e19cc8816215))

## [1.32.0](https://github.com/PostHog/wizard/compare/v1.31.2...v1.32.0) (2026-02-10)


### Features

* add basic python language skill ([#254](https://github.com/PostHog/wizard/issues/254)) ([e09a4f5](https://github.com/PostHog/wizard/commit/e09a4f55cdf7ba990e4811b626425834b3e88502))
* Add Nuxt.js and Vue ([#260](https://github.com/PostHog/wizard/issues/260)) ([29668c9](https://github.com/PostHog/wizard/commit/29668c9c39d017ed90045299e2783f440227b432))
* Android support ([#262](https://github.com/PostHog/wizard/issues/262)) ([747ec11](https://github.com/PostHog/wizard/commit/747ec112fa997478b6517d5fdc77bc012a59cda3))
* angular support ([#264](https://github.com/PostHog/wizard/issues/264)) ([3f9c3a2](https://github.com/PostHog/wizard/commit/3f9c3a22d1def33df22a53b3222060f3ad8eb5a8))
* astro support ([#267](https://github.com/PostHog/wizard/issues/267)) ([45fa91b](https://github.com/PostHog/wizard/commit/45fa91b06500ea98ccff51cca1203ca8e79f470a))
* fastapi skill ([#251](https://github.com/PostHog/wizard/issues/251)) ([9872950](https://github.com/PostHog/wizard/commit/98729507fc5ecf7e517d1bfdb1dc8df54452c396))
* react native and expo support ([#268](https://github.com/PostHog/wizard/issues/268)) ([e87a903](https://github.com/PostHog/wizard/commit/e87a9030fc96cf695d7bac373743bb58745b5d47))
* SvelteKit support for wizard ([#261](https://github.com/PostHog/wizard/issues/261)) ([c04fc4a](https://github.com/PostHog/wizard/commit/c04fc4a5bb73285c70723ca5ab58ee67e0a9c0ea))
* Swift integration support ([#259](https://github.com/PostHog/wizard/issues/259)) ([8a7e164](https://github.com/PostHog/wizard/commit/8a7e164e397de25ea675e7da899a47e1e1f3d107))
* tanstack router and start support ([#252](https://github.com/PostHog/wizard/issues/252)) ([77509be](https://github.com/PostHog/wizard/commit/77509be0ea0b22876d92a3bd2479364fcaad957a))


### Bug Fixes

* django detection bug ([#258](https://github.com/PostHog/wizard/issues/258)) ([368d89f](https://github.com/PostHog/wizard/commit/368d89f08938ddfa7e05d4eb18bac04890fac65d))
* Explicitly disallow reading .env file contents, add local-only .env write tool ([#263](https://github.com/PostHog/wizard/issues/263)) ([5e6bbe7](https://github.com/PostHog/wizard/commit/5e6bbe74b6c14172fcb4684e0d55cf73e502c8e7))

## [1.31.2](https://github.com/PostHog/wizard/compare/v1.31.1...v1.31.2) (2026-02-03)


### Bug Fixes

* changes based on the `wizard remark` event ([#249](https://github.com/PostHog/wizard/issues/249)) ([7de6b67](https://github.com/PostHog/wizard/commit/7de6b679af6bfbf7a731541caa61cdeb11d93458))

## [1.31.1](https://github.com/PostHog/wizard/compare/v1.31.0...v1.31.1) (2026-01-27)


### Bug Fixes

* break the handlSDKMessage loop after agent completed successfully ([#246](https://github.com/PostHog/wizard/issues/246)) ([80a71ec](https://github.com/PostHog/wizard/commit/80a71ec5a068743666633856e811d705abde35e4))

## [1.31.0](https://github.com/PostHog/wizard/compare/v1.30.0...v1.31.0) (2026-01-22)


### Features

* Transmit remarks about integration docs defects on conclusion ([#243](https://github.com/PostHog/wizard/issues/243)) ([909baaf](https://github.com/PostHog/wizard/commit/909baaf229a082b9f842fa215a520c87b5b1c359))


### Bug Fixes

* use EU subdomain for MCP OAuth routing ([#240](https://github.com/PostHog/wizard/issues/240)) ([3120d79](https://github.com/PostHog/wizard/commit/3120d7988db41b808338b7e54d47a5e0fcbcd74c))

## [1.30.0](https://github.com/PostHog/wizard/compare/v1.29.0...v1.30.0) (2026-01-21)


### Features

* laravel wizard support ([#238](https://github.com/PostHog/wizard/issues/238)) ([fe5a220](https://github.com/PostHog/wizard/commit/fe5a220c91752a9e2886140e72f4881447322b15))

## [1.29.0](https://github.com/PostHog/wizard/compare/v1.28.0...v1.29.0) (2026-01-21)


### Features

* flask init support ([#234](https://github.com/PostHog/wizard/issues/234)) ([5fe71fe](https://github.com/PostHog/wizard/commit/5fe71fe73f5003878b80edb1faf812a71eefb5a7))

## [1.28.0](https://github.com/PostHog/wizard/compare/v1.27.1...v1.28.0) (2026-01-20)


### Features

* anthropic status check ([#236](https://github.com/PostHog/wizard/issues/236)) ([8415459](https://github.com/PostHog/wizard/commit/84154594e693f3f0d012519b4d92261fe9bdf9d4))

## [1.27.1](https://github.com/PostHog/wizard/compare/v1.27.0...v1.27.1) (2026-01-20)


### Bug Fixes

* Resilience to Agent SDK cleanup burps ([#231](https://github.com/PostHog/wizard/issues/231)) ([7572038](https://github.com/PostHog/wizard/commit/75720385542293d3a0114415edc3fe5582fbb377))

## [1.27.0](https://github.com/PostHog/wizard/compare/v1.26.0...v1.27.0) (2026-01-19)


### Features

* django skill ([#230](https://github.com/PostHog/wizard/issues/230)) ([f18d7d2](https://github.com/PostHog/wizard/commit/f18d7d21ac9b0193febdc8e09b6080d05de454a8))

## [1.26.0](https://github.com/PostHog/wizard/compare/v1.25.0...v1.26.0) (2026-01-15)


### Features

* add region param and OAuth option for MCP setup ([#220](https://github.com/PostHog/wizard/issues/220)) ([bd2a09d](https://github.com/PostHog/wizard/commit/bd2a09d76b1fa1197a3ef0c1cb2a24f4b9f13253))
* Updates for skill use and skill installation ([#222](https://github.com/PostHog/wizard/issues/222)) ([11654c4](https://github.com/PostHog/wizard/commit/11654c41496776119df2905c85a1776745d50afa))


### Bug Fixes

* ci copy ([#224](https://github.com/PostHog/wizard/issues/224)) ([7d12a39](https://github.com/PostHog/wizard/commit/7d12a39f28042733e61c9877f05e2a7df94d5547))

## [1.25.0](https://github.com/PostHog/wizard/compare/v1.24.0...v1.25.0) (2026-01-12)


### Features

* react router agent ([#215](https://github.com/PostHog/wizard/issues/215)) ([0a8f918](https://github.com/PostHog/wizard/commit/0a8f9185f544d436939fac5e5829ae39bc221faf))
* Use bigger safe tools list ([#218](https://github.com/PostHog/wizard/issues/218)) ([6d819cd](https://github.com/PostHog/wizard/commit/6d819cd07485cb42c80f3a75ed5073ea76e745c8))

## [1.24.0](https://github.com/PostHog/wizard/compare/v1.23.0...v1.24.0) (2026-01-09)


### Features

* CI mode for wizard ([#216](https://github.com/PostHog/wizard/issues/216)) ([3bf2558](https://github.com/PostHog/wizard/commit/3bf255891590c5743a7115f4bff29e68bcd9fc34))

## [1.23.0](https://github.com/PostHog/wizard/compare/v1.22.0...v1.23.0) (2026-01-08)


### Features

* use llm gateway service ([#211](https://github.com/PostHog/wizard/issues/211)) ([9dc13af](https://github.com/PostHog/wizard/commit/9dc13af819841013512aba9fa847c92ded7cd217))


### Bug Fixes

* **ci:** incorrect action name ([9b53b22](https://github.com/PostHog/wizard/commit/9b53b22e4ed4bcd9b4d802160beab02c6303bb0f))
* **ci:** invalid yaml syntax ([810d910](https://github.com/PostHog/wizard/commit/810d910ca16a6f22d2c67d9ffac17e673ffa50f2))
* **ci:** use correct input names ([370bfc7](https://github.com/PostHog/wizard/commit/370bfc79f17dc97e66e3db56e6f33240ab4f5b75))

## [1.22.0](https://github.com/PostHog/wizard/compare/v1.21.1...v1.22.0) (2025-12-17)


### Features

* Add insight and dashboard creation scopes ([#200](https://github.com/PostHog/wizard/issues/200)) ([eb9617f](https://github.com/PostHog/wizard/commit/eb9617f62aaeaf6e9e8d0c882293088170e08347))

## [1.21.1](https://github.com/PostHog/wizard/compare/v1.21.0...v1.21.1) (2025-12-15)


### Bug Fixes

* Remove `posthog/agent`, directly integrate with CASDK ([#196](https://github.com/PostHog/wizard/issues/196)) ([db8e745](https://github.com/PostHog/wizard/commit/db8e745dc4bff5503ad734741e3bf5945ed4e46a))

## [1.21.0](https://github.com/PostHog/wizard/compare/v1.20.0...v1.21.0) (2025-12-04)


### Features

* update mcp installations ([#191](https://github.com/PostHog/wizard/issues/191)) ([742fb33](https://github.com/PostHog/wizard/commit/742fb33c9f9f82d9f8c29fdb307c6663b648383d))


### Bug Fixes

* Update e2e deps for react and next ([#192](https://github.com/PostHog/wizard/issues/192)) ([c6ae6d9](https://github.com/PostHog/wizard/commit/c6ae6d9bb22db37b5c899d9a6aa254b3c37acd28))

## [1.20.0](https://github.com/PostHog/wizard/compare/v1.19.0...v1.20.0) (2025-12-02)


### Features

* generalized agent runner and MCP error detection ([#176](https://github.com/PostHog/wizard/issues/176)) ([fba19b3](https://github.com/PostHog/wizard/commit/fba19b332001c1238bb405f1fc97a233e0e07df1))
* use trusted publishing for the npm package ([#184](https://github.com/PostHog/wizard/issues/184)) ([8153876](https://github.com/PostHog/wizard/commit/8153876233c560a4b98a69090cb20fa94abe518c))


### Bug Fixes

* correct repository URLs to use 'PostHog' ([#187](https://github.com/PostHog/wizard/issues/187)) ([dcf58fa](https://github.com/PostHog/wizard/commit/dcf58fa6d196453c8795e337c922b88978481cc8))
* update Node version from 18 to 24 in publishing workflow ([#186](https://github.com/PostHog/wizard/issues/186)) ([93374dc](https://github.com/PostHog/wizard/commit/93374dc6a4834771ac5f5c3fbda5ada56054d28e))
* update node-forge versions from transitive deps ([#188](https://github.com/PostHog/wizard/issues/188)) ([84365f6](https://github.com/PostHog/wizard/commit/84365f6b820ea8aa6683fdf149f1ab536c6d0fee))

## [1.19.0](https://github.com/PostHog/wizard/compare/v1.18.0...v1.19.0) (2025-11-26)


### Features

* Migrate to pnpm 10 ([#181](https://github.com/PostHog/wizard/issues/181)) ([e5b2112](https://github.com/PostHog/wizard/commit/e5b21121ddd0aef8d264cf2c646909d5dffca0c4))


### Bug Fixes

* use dynamic import to fix ESM/CJS startup ([#182](https://github.com/PostHog/wizard/issues/182)) ([a0b84be](https://github.com/PostHog/wizard/commit/a0b84be50755d65d07aadb02e2f85d01dc15c949))

## [1.18.0](https://github.com/PostHog/wizard/compare/v1.17.0...v1.18.0) (2025-11-20)


### Features

* add introspect scope ([e386083](https://github.com/PostHog/wizard/commit/e3860831fa3d3cbc232330ce7b22eb3230f51285))

## [1.17.0](https://github.com/PostHog/wizard/compare/v1.16.2...v1.17.0) (2025-11-17)


### Features

* add codex mcp client ([#157](https://github.com/PostHog/wizard/issues/157)) ([5051759](https://github.com/PostHog/wizard/commit/5051759da0980ca773d6550b22ab7c9bad519436))

## [1.16.2](https://github.com/PostHog/wizard/compare/v1.16.1...v1.16.2) (2025-11-17)


### Bug Fixes

* Claude Code support for MCP server installation ([#169](https://github.com/PostHog/wizard/issues/169)) ([98589b9](https://github.com/PostHog/wizard/commit/98589b9899b97738ba3359eac39f37cb2c182e99))
* **mcp:** add protocol explicitly ([#174](https://github.com/PostHog/wizard/issues/174)) ([a37c1b2](https://github.com/PostHog/wizard/commit/a37c1b2a50899e970351111e6acfa7cd90d251e7))

## [1.16.1](https://github.com/PostHog/wizard/compare/v1.16.0...v1.16.1) (2025-11-06)


### Bug Fixes

* MCP connection should happen over HTTPS ([#167](https://github.com/PostHog/wizard/issues/167)) ([aa9bcc2](https://github.com/PostHog/wizard/commit/aa9bcc2ad6fb7ef9871ed52d49827c78f75944db))

## [1.16.0](https://github.com/PostHog/wizard/compare/v1.15.0...v1.16.0) (2025-10-28)


### Features

* @posthog/agent integrations for Next.js ([#160](https://github.com/PostHog/wizard/issues/160)) ([f95b78c](https://github.com/PostHog/wizard/commit/f95b78c6475a583f5e47c0af8650d77fe5a0ef49))

## [1.15.0](https://github.com/PostHog/wizard/compare/v1.14.0...v1.15.0) (2025-10-24)


### Features

* **mcp:** local mcp server management ([#151](https://github.com/PostHog/wizard/issues/151)) ([f40e4be](https://github.com/PostHog/wizard/commit/f40e4bee80706c355e800810d6c2a211777ed383))
* repace cli flow with oauth ([#158](https://github.com/PostHog/wizard/issues/158)) ([38e0811](https://github.com/PostHog/wizard/commit/38e0811fe0077cd60de58502e50998f2794d836c))


### Bug Fixes

* make 429 error more descriptive ([#149](https://github.com/PostHog/wizard/issues/149)) ([b7955af](https://github.com/PostHog/wizard/commit/b7955af8bf663a926d684d625a792294265e99fe))

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
