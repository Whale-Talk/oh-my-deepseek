# Third-party notices

## oh-my-claudecode role prompts

The files under `src/roles/` (`planner.md`, `architect.md`, `critic.md`,
`executor.md`, `verifier.md`) are byte-for-byte copies of the corresponding
`agents/*.md` role prompts from
[oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode)
(npm package `oh-my-claude-sisyphus`), licensed under the MIT License,
Copyright (c) Yeachan Heo.

These files are ported unmodified. The plugins append a short workflow-adaptation
block at runtime (see `src/scripts.ts`) rather than editing the upstream text, so
the ported prompts remain diffable against their source of truth.

The MIT License text follows:

```
MIT License

Copyright (c) 2025 Yeachan Heo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
