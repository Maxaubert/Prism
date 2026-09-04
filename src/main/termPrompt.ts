/**
 * The shell's prompt reports where it is (2026-09-04, #99).
 *
 * Windows Terminal's convention: the prompt prints OSC 9;9 with the current
 * folder, and the host reads it. Prism already hands pwsh a bootstrap command
 * at spawn (the PSReadLine options), so the hook rides the same startup - it
 * WRAPS whatever `prompt` the profile installed rather than replacing it, so
 * oh-my-posh, starship and a hand-written prompt all survive and merely gain
 * an invisible prefix. Only the FileSystem provider is reported: a cd into
 * `Cert:` or `HKCU:` is not a folder the tree could show.
 *
 * cmd has no prompt function but its PROMPT variable takes `$e` for escape,
 * which is how Windows Terminal's own docs do it. WSL and bash get nothing:
 * their cwd is another world's path and Prism does not write into them either.
 */

const ESC = '$([char]27)'

/** Appended to the PowerShell bootstrap (`-Command`), pwsh and 5.1 alike. */
export const PS_PROMPT_HOOK =
  // Captured once: a second wrap (a profile re-run, a nested pwsh) would
  // otherwise wrap the wrapper and print the report twice.
  'if (-not (Test-Path Variable:global:__prismPrompt)) { $global:__prismPrompt = $function:prompt }; ' +
  'function global:prompt { ' +
  "$o = if ($global:__prismPrompt) { (& $global:__prismPrompt) -join '' } else { 'PS> ' }; " +
  `if ($PWD.Provider.Name -eq 'FileSystem') { "${ESC}]9;9;$($PWD.ProviderPath)${ESC}\\" + $o } else { $o } }`

/**
 * Directory names in `ls` as bold blue TEXT rather than pwsh's default of
 * bold on a blue BACKGROUND, and nothing else coloured (owner, 2026-09-04). pwsh's default assumes a
 * dark navy console where the block reads as a tint; on Prism's own palette
 * it reads as a selection. Guarded, because Windows PowerShell has no
 * $PSStyle. It runs AFTER the profile (that is when -Command executes), so
 * inside Prism it overrides a profile's own choice: Prism's terminal wears
 * Prism's palette, and this is one more part of that look, like the theme.
 */
export const PS_FILE_STYLE =
  'if (Get-Variable PSStyle -ErrorAction SilentlyContinue) { ' +
  `$PSStyle.FileInfo.Directory = "${ESC}[34;1m"; ` +
  // Files in the text colour, whatever they are: the .exe green, the .ps1
  // yellow and the .zip red made a listing read as a syntax-highlighted
  // document (owner, same day). Empty means "no style", which is the
  // terminal's own foreground - white on a dark theme, near-black on a
  // light one - and so is the table header, which pwsh paints green.
  "$PSStyle.FileInfo.Executable = ''; $PSStyle.FileInfo.SymbolicLink = ''; " +
  "$PSStyle.FileInfo.Extension.Clear(); " +
  // TableHeader is the green header row; CustomTableHeaderLabel is the
  // italic green on a column whose label is not its property's name
  // ("Length"); FormatAccent is the accent the rest of Format-* uses.
  "$PSStyle.Formatting.TableHeader = ''; $PSStyle.Formatting.CustomTableHeaderLabel = ''; " +
  "$PSStyle.Formatting.FormatAccent = '' }"

/** cmd's PROMPT with the report in front of whatever it already was. */
export function cmdPrompt(existing: string | undefined): string {
  return `$e]9;9;$P$e\\${existing || '$P$G'}`
}
