---
name: media-generation
description: "Generate images, logos, videos, or music through a dedicated media agent."
---

# Media generation

Use for requests to generate or substantially edit images, logos, videos, music, audio, GIFs, or other creative media.

## Route

- Delegate generation/processing to agent `media` with `sessions_spawn`.
- Parent/personal agents should not call image/video/music generation tools directly unless no `media` agent is configured or the user explicitly asks for a direct provider-specific workflow.
- If agent `media` is unavailable or subagent spawning is blocked, tell the operator to run `openclaw media-generation doctor` and then `openclaw media-generation setup-agent` if needed.
- Omit conversation context by default. Include only the source files/URLs and the user's media request that the media agent needs.
- On chat surfaces where subagents may auto-announce, disable auto-announcement when supported and have the parent relay the final result.
- For long runs, send at most one brief progress note; relay the final media/result yourself when `media` completes.

## Prompt hygiene

Keep creative prompt and operations separate:

- Preserve the user's creative prompt as literally as possible.
- Do not enrich, expand, stylize, translate, or rewrite the creative prompt unless the user asks.
- Do not put provider/model choices, number of variants, file format, dimensions, delivery channel, target recipient, or bookkeeping instructions inside the creative prompt.
- Pass those as operational constraints in the task for `media`.
- If multiple models/providers are requested, tell `media` to use the same identical creative prompt for each model unless a technical incompatibility requires a declared change.
- Ask `media` to return the complete effective prompt, model/provider, output file/path for each generated artifact, and concise transparency notes.

## Transparency

Ask `media` to explicitly report notable deviations:

- provider/model fallback or skipped preferred provider
- quota, auth, safety, timeout, transport, or tool errors
- retries, killed/stuck jobs, abandoned async jobs, or partial batches
- requested count/format/size/aspect ratio not fully delivered
- prompt changes or per-provider prompt adaptations
- quality caveats that materially affect usefulness

For non-trivial jobs, ask `media` to write a small manifest in the output directory with original prompt, requested vs delivered artifacts, providers attempted, effective prompts, deviations, and final outcome.

When relaying the final result, include those transparency notes. Do not rely on progress messages as the only place where fallbacks/errors are disclosed; some chat surfaces treat progress as temporary.

Suggested task shape:

```text
Creative prompt, verbatim:
<user's creative/media prompt>

Operational constraints:
- provider/model(s): ...
- count/variants: ...
- aspect ratio/size/format: ...
- source files/URLs: ...
- output/delivery requirements: ...

Return:
- generated file paths or media URLs
- model/provider used for each artifact
- complete effective prompt used for each artifact
- any prompt changes required by tool limits
- transparency notes: fallbacks/errors/retries/partial work/caveats, or `None`
- manifest path for non-trivial jobs
```

Example:

User: “Genera un logo con le lettere GP usando sia OpenAI sia Gemini”

- Creative prompt: `Genera un logo con le lettere GP`
- Operational constraints: generate once with OpenAI and once with Gemini, using the same prompt.

## Relay

- Send or attach generated media back to the user when the channel supports it.
- Before relaying generated image/logo/graphic results, verify that the media agent returned:
  - output path or media URL
  - tool used
  - provider/model used, when applicable
  - complete effective prompt, when an LLM image tool was used
  - transparency notes/fallbacks/deviations
- If any required detail is missing, do not relay the image as final yet. Ask/fetch the missing details from the media subagent first.
- Include concise labels: model/provider + complete effective prompt.
- Include concise transparency notes when anything deviated from the preferred/requested path; if everything went normally, keep it terse.
- If generation failed, report the exact blocker and the smallest useful next option.
