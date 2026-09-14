// Pasting images into the community email composer (#492).
//
// The composer's async half (upload → adopt → swap) is network-bound, but
// everything that decides *what the body ends up saying* is pure — and that is
// the half worth pinning, because it is what goes out to the whole community.
import { describe, expect, it } from 'vitest';
import {
  applyImagePaste,
  imagesFromClipboard,
  pastedImageMarkdown,
  pastedImageUrls,
  removeUploadPlaceholder,
  replaceUploadPlaceholder,
  uploadPlaceholder,
} from './emailImagePaste';

/** A clipboard, without a DOM. `items` is all `imagesFromClipboard` reads. */
function clipboard(items: { kind: string; type: string; file?: File }[]): DataTransfer {
  return {
    items: items.map((i) => ({ kind: i.kind, type: i.type, getAsFile: () => i.file ?? null })),
  } as unknown as DataTransfer;
}

const png = (name = 'shot.png') => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });

describe('imagesFromClipboard', () => {
  it('finds pasted image files', () => {
    const files = imagesFromClipboard(clipboard([{ kind: 'file', type: 'image/png', file: png() }]));
    expect(files.map((f) => f.name)).toEqual(['shot.png']);
  });

  it('is empty for a plain-text paste — which is what leaves that path alone', () => {
    expect(imagesFromClipboard(clipboard([{ kind: 'string', type: 'text/plain' }]))).toEqual([]);
  });

  it('ignores a non-image file, and keeps clipboard order for several images', () => {
    const files = imagesFromClipboard(
      clipboard([
        { kind: 'file', type: 'application/pdf', file: new File([''], 'a.pdf', { type: 'application/pdf' }) },
        { kind: 'file', type: 'image/png', file: png('one.png') },
        { kind: 'file', type: 'image/jpeg', file: png('two.jpg') },
      ]),
    );
    expect(files.map((f) => f.name)).toEqual(['one.png', 'two.jpg']);
  });

  it('drops an item that claims to be a file but yields none', () => {
    expect(imagesFromClipboard(clipboard([{ kind: 'file', type: 'image/png' }]))).toEqual([]);
  });
});

describe('applyImagePaste', () => {
  const paste = (over: Partial<Parameters<typeof applyImagePaste>[0]>) =>
    applyImagePaste({
      value: '',
      selectionStart: 0,
      selectionEnd: 0,
      text: '',
      placeholders: [uploadPlaceholder(1)],
      ...over,
    });

  it('drops a placeholder in at the caret', () => {
    const { value, caret } = paste({});
    expect(value).toBe(uploadPlaceholder(1));
    expect(caret).toBe(value.length);
  });

  it('gives the image its own line when pasted mid-sentence', () => {
    const { value } = paste({ value: 'Look at this', selectionStart: 12, selectionEnd: 12 });
    expect(value).toBe(`Look at this\n\n${uploadPlaceholder(1)}`);
  });

  it('does not pile up blank lines when the caret is already on one', () => {
    const { value } = paste({ value: 'Look at this\n\n', selectionStart: 14, selectionEnd: 14 });
    expect(value).toBe(`Look at this\n\n${uploadPlaceholder(1)}`);
    const one = paste({ value: 'Look at this\n', selectionStart: 13, selectionEnd: 13 });
    expect(one.value).toBe(`Look at this\n\n${uploadPlaceholder(1)}`);
  });

  it('keeps the text that follows on its own paragraph, and leaves the caret before it', () => {
    const { value, caret } = paste({ value: 'before after', selectionStart: 7, selectionEnd: 7 });
    expect(value).toBe(`before \n\n${uploadPlaceholder(1)}\n\nafter`);
    expect(value.slice(caret)).toBe('after');
  });

  it('replaces a selection, the way any paste does', () => {
    const { value } = paste({ value: 'keep DROP keep', selectionStart: 5, selectionEnd: 9 });
    expect(value).toBe(`keep \n\n${uploadPlaceholder(1)}\n\n keep`);
  });

  it('mixed text + image: the text lands exactly where a plain paste would, image after', () => {
    const { value } = paste({
      value: 'A|B',
      selectionStart: 1,
      selectionEnd: 1,
      text: 'hello',
      placeholders: [uploadPlaceholder(7)],
    });
    // "hello" is spliced at the caret untouched — that is the whole of "text
    // behaviour unchanged" — and only the image gets the paragraph break.
    expect(value).toBe(`Ahello\n\n${uploadPlaceholder(7)}\n\n|B`);
  });

  it('takes several images in clipboard order, each on its own line', () => {
    const { value } = paste({ placeholders: [uploadPlaceholder(1), uploadPlaceholder(2)] });
    expect(value).toBe(`${uploadPlaceholder(1)}\n\n${uploadPlaceholder(2)}`);
  });
});

describe('placeholder swap', () => {
  it('replaces only its own placeholder — concurrent pastes do not race', () => {
    const body = `${uploadPlaceholder(1)}\n\n${uploadPlaceholder(2)}`;
    const done = replaceUploadPlaceholder(body, 2, pastedImageMarkdown('https://flow.test/v1/email-images/abc'));
    expect(done).toBe(`${uploadPlaceholder(1)}\n\n![Pasted image](https://flow.test/v1/email-images/abc)`);
  });

  it('a failed upload takes its placeholder and its blank line with it', () => {
    const body = `Hi\n\n${uploadPlaceholder(1)}\n\nBye`;
    expect(removeUploadPlaceholder(body, 1)).toBe('Hi\n\nBye');
  });

  it('leaves the rest of the body alone when the failure was the only content', () => {
    expect(removeUploadPlaceholder(uploadPlaceholder(3), 3)).toBe('');
  });

  it('the placeholder never survives as a fetchable image', () => {
    // Belt and braces: if one somehow reached the renderer, its src is not
    // absolute http(s), and the email sanitizer drops such an <img> outright.
    expect(uploadPlaceholder(1)).not.toMatch(/https?:\/\//);
  });
});

describe('pastedImageUrls', () => {
  const url = (n: number) => `https://flow.test/v1/email-images/tok${n}`;

  it('finds the pasted images in the body, in order', () => {
    const body = `Hi\n\n${pastedImageMarkdown(url(1))}\n\nmore\n\n${pastedImageMarkdown(url(2))}`;
    expect(pastedImageUrls(body)).toEqual([url(1), url(2)]);
  });

  it('deduplicates the same image used twice', () => {
    const body = `${pastedImageMarkdown(url(1))}\n\n${pastedImageMarkdown(url(1))}`;
    expect(pastedImageUrls(body)).toEqual([url(1)]);
  });

  it('ignores an unrelated remote image, so the composer never fetches a stranger', () => {
    // A hand-typed ![](https://tracker.example/pixel.gif) in the strip would be
    // an outbound request from the admin's browser for nothing.
    expect(pastedImageUrls('![x](https://tracker.example/pixel.gif)')).toEqual([]);
  });

  it('ignores a placeholder still uploading', () => {
    expect(pastedImageUrls(uploadPlaceholder(1))).toEqual([]);
  });
});
