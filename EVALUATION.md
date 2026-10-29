# Evaluation and submission status

## Evidence from this environment

A real HTTP run used NVIDIA `nvidia/Nemotron-3.5-Super-VL` on Nebius Token Factory and the explicitly selected experimental WSL/bubblewrap runner. The run returned two model proposals, two schema-valid proposals, and one model-generated case actually tested, alongside one supplied upstream-derived case. Two cases were tested, one differed, and ten comparisons were completed. The differing supplied case was reduced to `http\t://ww`; the exact outcomes and trace are in `evidence/latest_http_run.json`.

The source files are unmodified CPython `Lib/urllib/parse.py` at parent `bf124244f0595fb3b4f969a31644b7d110de41ef` and commit `8a595744e696a0fb92dccc5d4e45da41571270a1`, associated with [bpo-43882](https://bugs.python.org/issue43882). The generated test for the observed baseline was run in a separate WSL sandbox against those pinned sources: one pass on the older revision and one assertion failure on the newer revision. The observed change is not automatically a defect; the developer must decide which behavior is desired. Model-generated cases did not produce the observed difference in that run. Results are not proof of general detection rates.

The automated project suite last reported 15 passed and one Docker integration test skipped. Docker Desktop failed to start in this environment; Docker isolation was not validated here. The WSL runner is experimental, opt-in, for trusted non-adversarial code only, and lacks aggregate cgroup quotas. Same-interpreter outputs are not tamper-proof. Model-call total cost for this product was not captured; do not infer it from unrelated experiments.

## Positioning and limits

Behavioral differential testing is established work. [CounterPatch](https://github.com/kirilkirkov/counterpatch) already describes cross-revision adversarial inputs, shrinking and pytest export. This project does not claim novelty for those concepts or user validation. [Stack Overflow's 2025 survey](https://survey.stackoverflow.co/2025/ai) reports widespread frustration with almost-correct AI solutions; it does not establish demand for this particular app.

The intended hackathon track is Coding and Agentic Engineering, subject to final fit review. It uses live NVIDIA Nemotron inference through Nebius Token Factory for test-case proposals, and deterministic execution for comparison. This prototype compares self-contained Python modules and JSON-compatible calls, not arbitrary repositories or non-Python programs.

## Remaining submission work

The [official rules](https://nebiusglobalaihackathon.devpost.com/rules) require a publicly accessible working demo, a public licensed source repository, a public YouTube video under three minutes, project description, track selection and feedback. This local prototype is not safe as a public multi-user execution service; no public working demo or YouTube video is available and no Devpost submission has been made. Before submission, establish a suitable isolated hosted runner, durable abuse and budget controls, judge access through December 15, and an actual recorded demo. Validate Docker or another appropriate isolation environment independently.
