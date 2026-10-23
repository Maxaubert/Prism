import type { JSX } from 'react'
import { Modal } from './Modal'
import { ROW_BUTTON } from '../settings/fields'

/**
 * ONE LINE BEFORE A MODEL WITH A CATCH IS DOWNLOADED (#121; owner, 2026-10-04:
 * "say ... this model doesn't support all languages when downloading", and
 * "don't make the pop-up obnoxious, don't have extra text, just have it be
 * simple"). The line, Cancel and Download, and nothing else: no title, no
 * vendor, no reason. Both buttons are the neutral row button, since only Save
 * wears the accent (#42). Escape and a press outside are Cancel, as in
 * ThemeSwitchAsk, whose frame this is. Props only.
 */
export default function ModelDownloadAsk({
  text,
  onDownload,
  onCancel
}: {
  text: string
  onDownload: () => void
  onCancel: () => void
}): JSX.Element {
  return (
    <Modal
      shadow={false}
      onCancel={onCancel}
      role="alertdialog"
      describedBy="model-download-ask-text"
      focus="[data-ask-download]"
      scrimAttrs={{ 'data-model-download-ask': true }}
      boxClassName="w-full max-w-[360px] p-5"
    >
      <p id="model-download-ask-text" className="text-[13px] leading-relaxed text-[var(--p-text)]">
        {text}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button data-ask-cancel className={ROW_BUTTON} onClick={onCancel}>
          Cancel
        </button>
        <button data-ask-download className={ROW_BUTTON} onClick={onDownload}>
          Download
        </button>
      </div>
    </Modal>
  )
}
