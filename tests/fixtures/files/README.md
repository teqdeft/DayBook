# File fixtures

Small files for the end-to-end tests of files on tasks and the Files tab (CONTRACT 27):
`tests/e2e/task-files.spec.js`, `project-files.spec.js` and `project-board.spec.js` pick them in a
real browser through `tests/e2e/support/files.js`. The PDF and Word files are in `tests/fixtures/pdf`
and `tests/fixtures/docx`.

Every file is plain and harmless: the deploy branch copies `tests/` to the host, where a malware
scanner could quarantine anything that looks like an attack. None holds a script, an event
attribute, a link or a real program; the tests check how Daybook serves them (the headers), never
what a browser would do with them.

`make-fixtures.mjs` writes every file by hand, with nothing but `node:zlib`. To change one, change
the script and run it from the repo root:

```
node tests/fixtures/files/make-fixtures.mjs
```

| File              | What it is                                                    | What Daybook should do                                           |
| ----------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| `logo.png`        | A 48 x 48 PNG                                                 | A picture: a thumbnail, the viewer, `/view` as `image/png`       |
| `photo.jpg`       | A 64 x 48 grayscale baseline JPEG (one shade per 8 x 8 block) | A picture, as `image/jpeg`                                       |
| `wrong-bytes.png` | One line of plain text with a `.png` name                     | Not a picture: downloads only, `/view` is 404                    |
| `drawing.svg`     | One plain `<rect>`                                            | Downloads only (`application/octet-stream`), `/view` is 404      |
| `page.html`       | `<!doctype html><title>Test</title><p>Test page</p>`          | Downloads only (`application/octet-stream`), `/view` is 404      |
| `setup.exe`       | 16 bytes of plain text with a program's name                  | Downloads, with "Program file. Open it only if you trust …"      |
| `notes.txt`       | Two lines of text                                             | A text file: downloads; a project one is read for the AI summary |
| `empty.txt`       | Nothing                                                       | "empty.txt is empty." and never sent                             |

`.gitattributes` marks them binary, so Git on Windows can't change their line endings and the
downloaded bytes always equal the fixture's.
