# First signed-release qualification: short Reader input pause

- Protected `v0.1.0` peels to `71f5b7ef48e7190d38266aa1cbc6bdd9d0cd5c4b`.
  Parent `44531165012/1` dispatched `44531226887/1`. Web shard 1,
  job `135584775550`, failed the original wheel monotonicity assertion. The
  later missing navigation/import evidence came from gates that never ran.
  Image inspection, rehearsal and publication were skipped; signing was not tested.
- Independently checked the failing shard artifact `14535315168`,
  SHA-256 `bb28c02fa82462f06206579a9b146fd2f440d38152f5342817129808449f09da`.
  Short fixture, mixed pointer/wheel: raw scroll offset went **2720 → 451**
  after **266.7 ms** without a coordinate change. The artifact did not track
  a shared reading-line anchor for that sample; raw motion alone cannot prove
  a 2269px jump of the text.
- Added a separate 450ms interruption control without changing the original
  gestures, budgets or jobs. Same synthetic fixture, Windows Chrome: exact
  old sources **2645 → 375** (real article offset 84.6875 → 84.71875).
  Fixed sources **2645 → 2645** (84.6875 unchanged); reverse wheel moved
  immediately without an extra turn read. All 46 mounted cases and 100
  focused Node tests passed. This does not certify a physical device,
  Linux qualification, production backup, or a signed release.
