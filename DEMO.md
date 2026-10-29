# Delta Lab — under-three-minute demo draft

**Target runtime:** about 2:40 at a measured pace.
**Capture:** no local video is available. Computer Use stopped in the prior browser check, so this file is a storyboard and narration draft only; no recording or upload was made.

## Evidence for this draft

This script is tied to a live `/api/analyze` run made through the Delta Lab server with `DELTA_RUNNER=wsl`, Nemotron enabled, and the bundled upstream example. `/api/status` reported `runner=wsl`, `ready=true`, `docker=false`, and `model_configured=true`. The analysis returned `incomplete=false`.

| Evidence | Observed in the run |
|---|---|
| Function | `urlsplit` |
| Baseline fixture | `fixtures/cpython/parse_before.py`, 42,263 characters; CPython parent commit `bf124244f0595fb3b4f969a31644b7d110de41ef` |
| Proposed fixture | `fixtures/cpython/parse_after.py`, 42,303 characters; CPython commit `8a595744e696a0fb92dccc5d4e45da41571270a1` |
| Upstream issue | bpo-43882; bundled invocation is derived from its upstream test |
| Nemotron generation | 6 raw proposals; 6 schema-valid; 5 model-sourced cases actually tested |
| Run summary | 6 cases tested, 1 difference, 14 old/new comparisons, complete run |
| Supplied case reduced | `http\t://www.python\n.org\t/java\nscript:\talert('msg\r\n')/?query\n=\tsomething#frag\nment` → `http\t://ww`; 8 local shrink attempts |
| Observed old return | `['', '', 'http://ww', '', '']` |
| Observed proposed return | `['http', 'ww', '', '', '']` |

The five model-sourced cases matched in this run. The response does not identify whether the remaining valid proposal was deduplicated or excluded by the six-case cap. This was a live run, not a precomputed result. A new Nemotron run may produce different proposals or counts; use only results visible in the recording session.

## Storyboard and narration

### 0:00–0:18 — Set the boundary

**Screen:** Delta Lab title and empty workbench. Show the review note beside the comparison concept.

**Voiceover:** “Delta Lab compares two versions of a function by running both against the same inputs. A difference is evidence to review, not an automatic bug verdict.”

### 0:18–0:43 — Load the pinned source

**Screen:** Click **Load real CPython example**. Show `urlsplit`, the source notice, and the two Python revisions. Keep the source panes visible long enough to establish that these are the bundled CPython files.

**Voiceover:** “This example uses the parent of CPython commit `8a595744` and that commit itself, for bpo-43882. The supplied case comes from the upstream test. Delta Lab has no results preloaded; this run has to execute the code.”

### 0:43–1:05 — Show transmission and runner selection

**Screen:** Open the optional controls only if needed; keep Nemotron enabled. Point to **Data sent when you run** and the **Experimental WSL** status.

**Voiceover:** “With generation enabled, the server sends the function name, schema, case cap, an 18,000-character-capped diff, and up to 12,000 characters from each version to Nebius Token Factory. Supplied cases are excluded from that model request. The selected runner is experimental WSL with bubblewrap.”

### 1:05–1:27 — Generate and execute

**Screen:** Click **Generate cases & compare**. Hold on the progress state, then show the returned proposal, validity, and tested counts.

**Voiceover:** “Nemotron proposed six inputs. All six passed schema validation. Five model-sourced cases ran alongside the supplied upstream case. The run shows six tested cases and one behavioral difference.”

### 1:27–2:08 — Inspect the observed difference

**Screen:** Filter to **Differences**. Expand the first case and its trace. Show the original upstream input, then the simplified input `http\t://ww`; keep the backslash-t visible as a tab escape, not a literal backslash sequence from model text.

**Voiceover:** “The upstream string contains tabs and newlines. After eight local simplification attempts, the displayed counterexample is `http`, a tab, a colon, two slashes, and `ww`. On the baseline, the returned fields are empty scheme and netloc, with `http://ww` in the path. The proposed version returns scheme `http` and netloc `ww`. These are the runner’s observed outputs.”

### 2:08–2:40 — Qualify the result

**Screen:** Show the trace count and export explanation, then the runner disclosure. Do not click export during the recording unless you want to show the candidate-baseline expectation note.

**Voiceover:** “This run completed fourteen comparisons. The shrinker is a bounded local simplifier, not a proof of a globally minimal input. The WSL runner is experimental: it has no aggregate cgroup quotas, uses per-process CPU and address-space limits, and shares its process-count limit with the WSL user. It is not a VM and does not fall back to Docker. Use only trusted code, review the trace, and decide whether this behavioral change is a regression for your product.”

## Recording checklist

- Start the server with `DELTA_RUNNER=wsl` and verify the page says **Experimental WSL runner ready**. Do not imply Docker is selected; the live status for this run said `docker=false`.
- Load the bundled example, verify the commit notice, leave Nemotron enabled, and capture the live counts/results from the same run. If counts or outputs differ from this draft, rewrite the narration to match the recording.
- Keep the run-data disclosure legible on screen. Do not describe source as staying local: the enabled generation flow sends bounded source excerpts, the diff, schema, function name, and case cap to Nebius.
- Keep the case labeled as the upstream supplied input; label model cases as Nemotron proposals. Do not call the five matching model cases failures or claim the difference is automatically a bug.
- If the run is partial, stop this script and record the partial warning and reason instead. Do not narrate it as a completed six-case run.
- Do not add an export or test result not returned by the recorded run. The export treats baseline behavior as a candidate expectation and needs review.
