import { describe, expect, it } from 'vitest'
import { expand, meaningfulWords, searchHelp, stem, tokenise, withinOneEdit } from './search'
import type { HelpCategory, HelpEntry, HelpShell } from './types'

/**
 * A FIXTURE WRITTEN THE WAY THE CATALOGUE IS: task first, generous keywords
 * that name the same thing in other shells and the symptom someone would
 * type. The rankings below are only worth asserting against entries that look
 * like the real ones, so nothing here is shaped to make a test pass.
 */
const e = (
  id: string,
  shell: HelpShell,
  category: HelpCategory,
  task: string,
  summary: string,
  command: string,
  keywords: string[],
  more: Partial<HelpEntry> = {}
): HelpEntry => ({ id, shell, category, task, summary, command, keywords, ...more })

const FIXTURE: readonly HelpEntry[] = [
  // PowerShell
  e(
    'ps-biggest-files',
    'powershell',
    'files',
    'Find the biggest files in a folder',
    'Lists the ten largest files under a folder, biggest first, to see what is eating the disk.',
    'Get-ChildItem FOLDER -Recurse -File | Sort-Object Length -Descending | Select-Object -First 10 FullName, Length',
    [
      'large files',
      'big files',
      'huge',
      'size',
      'disk full',
      'what is taking space',
      'du',
      'largest',
      'sort by size'
    ],
    { placeholders: { FOLDER: 'The folder to look through' } }
  ),
  e(
    'ps-find-file-by-name',
    'powershell',
    'files',
    'Find a file by its name',
    'Looks through a folder and everything under it for names containing a word.',
    'Get-ChildItem FOLDER -Recurse -Filter "*NAME*"',
    [
      'search',
      'locate',
      'where is my file',
      'lost file',
      'filename',
      'wildcard',
      'dir /s',
      'find -name'
    ]
  ),
  e(
    'ps-list-files',
    'powershell',
    'files',
    'List the files in a folder',
    'Shows what is in the folder you are in, or in the one you name.',
    'Get-ChildItem',
    ['ls', 'dir', 'show files', 'directory listing', 'contents', 'what is in here', 'gci']
  ),
  e(
    'ps-hidden-files',
    'powershell',
    'files',
    'Show hidden files',
    'Lists a folder including the hidden and system items a plain listing leaves out.',
    'Get-ChildItem -Force',
    ['ls -a', 'dir /a', 'dotfiles', 'invisible', 'hidden folders', 'show all', 'system files']
  ),
  e(
    'ps-delete-file',
    'powershell',
    'files',
    'Delete a file',
    'Removes one file for good.',
    'Remove-Item FILE',
    ['remove', 'rm', 'del', 'erase', 'trash', 'get rid of'],
    { danger: 'The file does not go to the Recycle Bin.' }
  ),
  e(
    'ps-delete-folder',
    'powershell',
    'folders',
    'Delete a folder and everything in it',
    'Removes a folder with all of its contents, without asking.',
    'Remove-Item FOLDER -Recurse -Force',
    ['remove directory', 'rmdir', 'rm -rf', 'rd /s', 'erase folder', 'delete directory', 'wipe'],
    { danger: 'Everything inside is gone for good.' }
  ),
  e(
    'ps-make-folder',
    'powershell',
    'folders',
    'Make a new folder',
    'Creates an empty folder where you are.',
    'New-Item -ItemType Directory NAME',
    ['mkdir', 'md', 'create directory', 'new directory', 'add folder']
  ),
  e(
    'ps-up-one-folder',
    'powershell',
    'folders',
    'Go up one folder',
    'Moves to the folder that contains the one you are in.',
    'cd ..',
    [
      'go back',
      'back a folder',
      'parent folder',
      'up a level',
      'cd ..',
      'leave folder',
      'out of this folder'
    ]
  ),
  e(
    'ps-previous-folder',
    'powershell',
    'folders',
    'Return to the folder I was just in',
    'Jumps to wherever you were before the last move, and back again.',
    'cd -',
    ['previous folder', 'last folder', 'cd -', 'popd', 'where i was', 'toggle']
  ),
  e(
    'ps-where-am-i',
    'powershell',
    'folders',
    'Show which folder I am in',
    'Prints the full path of the current folder.',
    'Get-Location',
    [
      'pwd',
      'where am i',
      'current folder',
      'current directory',
      'cwd',
      'working directory',
      'this path'
    ]
  ),
  e(
    'ps-search-text',
    'powershell',
    'text',
    'Find text inside files',
    'Searches the contents of files for a word or pattern and shows the matching lines.',
    'Select-String -Path FOLDER\\* -Pattern "TEXT"',
    [
      'grep',
      'findstr',
      'search in files',
      'find a word',
      'contains',
      'look inside',
      'string',
      'match'
    ]
  ),
  e(
    'ps-list-processes',
    'powershell',
    'processes',
    'See what is running',
    'Lists every running program with its id, memory and processor time.',
    'Get-Process',
    ['ps', 'tasklist', 'task manager', 'processes', 'running programs', 'apps', 'top']
  ),
  e(
    'ps-kill-process',
    'powershell',
    'processes',
    'Stop a program that will not close',
    'Ends a program by name when it has frozen and its window ignores you.',
    'Stop-Process -Name NAME -Force',
    [
      'kill',
      'kill process',
      'taskkill',
      'end task',
      'terminate',
      'force quit',
      'frozen',
      'not responding',
      'hung'
    ],
    { danger: 'Unsaved work in that program is lost.' }
  ),
  e(
    'ps-port-in-use',
    'powershell',
    'processes',
    'See what is using a port',
    'Names the process holding a port, for when a server says the address is already in use.',
    'Get-NetTCPConnection -LocalPort PORT | Select-Object OwningProcess',
    [
      'port already in use',
      'address already in use',
      'eaddrinuse',
      'listening',
      'netstat',
      'lsof',
      'localhost'
    ]
  ),
  e(
    'ps-test-port',
    'powershell',
    'network',
    'Check whether a port is open on another machine',
    'Tries a connection to a host and port and says whether it got through.',
    'Test-NetConnection HOST -Port PORT',
    ['telnet', 'nc', 'reachable', 'firewall', 'connect', 'can i reach']
  ),
  e(
    'ps-ip-address',
    'powershell',
    'network',
    'Show my IP address',
    'Lists the addresses this machine has on each network.',
    'Get-NetIPAddress -AddressFamily IPv4',
    ['ipconfig', 'ifconfig', 'ip a', 'local ip', 'network address', 'what is my ip', 'lan']
  ),
  e(
    'ps-unzip',
    'powershell',
    'files',
    'Unzip an archive',
    'Unpacks a zip file into a folder.',
    'Expand-Archive FILE.zip -DestinationPath FOLDER',
    ['unzip', 'extract', 'decompress', 'open zip', 'unpack', 'tar -x']
  ),
  e(
    'ps-zip',
    'powershell',
    'files',
    'Zip a folder',
    'Packs a folder into one zip file.',
    'Compress-Archive FOLDER FILE.zip',
    ['zip', 'compress', 'archive', 'pack', 'make a zip']
  ),
  e(
    'ps-env-var',
    'powershell',
    'system',
    'See an environment variable',
    'Prints the value of one variable, PATH for instance.',
    '$env:NAME',
    ['env', 'printenv', 'echo %path%', 'path variable', 'environment', 'variables']
  ),
  e(
    'ps-history',
    'powershell',
    'shell',
    'See the commands I typed before',
    'Lists what you ran in this session, oldest first.',
    'Get-History',
    ['history', 'previous commands', 'last command', 'recall', 'what did i run']
  ),
  e(
    'ps-clear',
    'powershell',
    'shell',
    'Clear the screen',
    'Empties the window and puts the prompt at the top.',
    'Clear-Host',
    ['cls', 'clear', 'clean screen', 'wipe terminal', 'ctrl l']
  ),
  e(
    'ps-admin',
    'powershell',
    'system',
    'Open a shell as administrator',
    'Starts a second PowerShell with elevated rights, after the Windows prompt.',
    'Start-Process pwsh -Verb RunAs',
    [
      'admin',
      'elevated',
      'sudo',
      'run as administrator',
      'uac',
      'permission denied',
      'access denied'
    ]
  ),
  e(
    'ps-copy-file',
    'powershell',
    'files',
    'Copy a file',
    'Makes a second copy somewhere else.',
    'Copy-Item FILE DESTINATION',
    ['cp', 'copy', 'duplicate', 'clone', 'backup']
  ),
  e(
    'ps-rename',
    'powershell',
    'files',
    'Rename a file',
    'Gives a file a new name where it is.',
    'Rename-Item OLD NEW',
    ['ren', 'mv', 'move', 'change name']
  ),
  e(
    'ps-whoami',
    'powershell',
    'system',
    'Show which user I am signed in as',
    'Prints the account this shell runs under.',
    'whoami',
    ['who am i', 'username', 'current user', 'account', 'logged in']
  ),
  // cmd
  e(
    'cmd-list-files',
    'cmd',
    'files',
    'List the files in a folder',
    'Shows what is in the folder you are in.',
    'dir',
    ['ls', 'show files', 'contents', 'directory listing']
  ),
  e(
    'cmd-delete-folder',
    'cmd',
    'folders',
    'Delete a folder and everything in it',
    'Removes a folder with all of its contents, without asking.',
    'rmdir /s /q FOLDER',
    ['remove directory', 'rd', 'rm -rf', 'erase folder', 'delete directory'],
    { danger: 'Everything inside is gone for good.' }
  ),
  e(
    'cmd-find-program',
    'cmd',
    'system',
    'Find where a program is installed',
    'Prints the full path of the exe a command name runs.',
    'where NAME',
    ['which', 'path of exe', 'locate command', 'is it installed', 'get-command']
  ),
  e(
    'cmd-kill',
    'cmd',
    'processes',
    'Stop a program that will not close',
    'Ends a program by its exe name.',
    'taskkill /IM NAME.exe /F',
    ['kill', 'kill process', 'end task', 'terminate', 'force quit', 'frozen'],
    { danger: 'Unsaved work in that program is lost.' }
  ),
  e(
    'cmd-port',
    'cmd',
    'processes',
    'See what is using a port',
    'Finds the line for a port, whose last column is the process id.',
    'netstat -ano | findstr :PORT',
    ['port already in use', 'address already in use', 'listening', 'lsof']
  ),
  e('cmd-clear', 'cmd', 'shell', 'Clear the screen', 'Empties the window.', 'cls', [
    'clear',
    'clean screen',
    'wipe'
  ]),
  // bash
  e(
    'bash-biggest-files',
    'bash',
    'files',
    'Find the biggest files in a folder',
    'Lists the ten largest files under a folder, biggest first.',
    'find FOLDER -type f -exec du -h {} + | sort -rh | head -n 10',
    ['large files', 'big files', 'huge', 'size', 'disk full', 'what is taking space', 'largest']
  ),
  e(
    'bash-grep',
    'bash',
    'text',
    'Find text inside files',
    'Searches the contents of every file under a folder and shows the matching lines.',
    'grep -rn "TEXT" FOLDER',
    [
      'search in files',
      'find a word',
      'contains',
      'select-string',
      'findstr',
      'look inside',
      'string'
    ]
  ),
  e(
    'bash-filter-output',
    'bash',
    'text',
    'Keep only the lines of output that mention something',
    'Pipes any command through a filter so only matching lines are shown.',
    'COMMAND | grep TEXT',
    ['filter', 'pipe', 'only lines with', 'narrow down', 'where-object']
  ),
  e(
    'bash-delete-folder',
    'bash',
    'folders',
    'Delete a folder and everything in it',
    'Removes a folder with all of its contents, without asking.',
    'rm -rf FOLDER',
    ['remove directory', 'rmdir', 'erase folder', 'delete directory'],
    { danger: 'Everything inside is gone for good.' }
  ),
  e(
    'bash-kill',
    'bash',
    'processes',
    'Stop a running program',
    'Asks a process to end, by its id.',
    'kill PID',
    ['kill process', 'end task', 'terminate', 'quit', 'frozen', 'taskkill', 'stop-process'],
    {
      variants: [{ label: 'It ignores the polite request', command: 'kill -9 PID' }],
      danger: 'Unsaved work is lost.'
    }
  ),
  e(
    'bash-port',
    'bash',
    'processes',
    'See what is using a port',
    'Names the process holding a port.',
    'lsof -i :PORT',
    ['port already in use', 'address already in use', 'eaddrinuse', 'listening', 'netstat']
  ),
  e(
    'bash-unzip',
    'bash',
    'files',
    'Unzip an archive',
    'Unpacks a zip file into a folder.',
    'unzip FILE.zip -d FOLDER',
    ['extract', 'decompress', 'unpack', 'expand-archive']
  ),
  e(
    'bash-hidden',
    'bash',
    'files',
    'Show hidden files',
    'Lists a folder including the names that start with a dot.',
    'ls -la',
    ['dotfiles', 'invisible', 'show all', 'dir /a']
  ),
  e(
    'bash-up',
    'bash',
    'folders',
    'Go up one folder',
    'Moves to the folder that contains this one.',
    'cd ..',
    ['go back', 'back a folder', 'parent folder', 'up a level']
  ),
  e(
    'bash-pwd',
    'bash',
    'folders',
    'Show which folder I am in',
    'Prints the full path of the current folder.',
    'pwd',
    ['where am i', 'current folder', 'current directory', 'cwd', 'get-location']
  ),
  e(
    'bash-less',
    'bash',
    'files',
    'Read a long file a page at a time',
    'Opens a file in a pager: space for the next page, q to leave.',
    'less FILE',
    ['pager', 'more', 'scroll a file', 'view file']
  ),
  // any shell
  e(
    'git-undo-commit',
    'any',
    'git',
    'Undo the last commit but keep the changes',
    'Takes the newest commit back and leaves its changes staged.',
    'git reset --soft HEAD~1',
    ['uncommit', 'revert commit', 'take back', 'committed too early', 'wrong commit'],
    { danger: 'Rewrites history: do not do it to a commit you have pushed.' }
  ),
  e(
    'git-discard',
    'any',
    'git',
    'Throw away my changes to a file',
    'Puts a file back to how the last commit had it.',
    'git restore FILE',
    ['undo', 'revert', 'discard', 'checkout', 'reset file'],
    { danger: 'The edits are gone for good.' }
  ),
  e(
    'git-log',
    'any',
    'git',
    'See the commit history',
    'Lists the last twenty commits, one line each.',
    'git log --oneline -n 20',
    ['history', 'log', 'past commits', 'what changed']
  ),
  e(
    'git-status',
    'any',
    'git',
    'See what has changed',
    'Shows the files that are modified, staged or new.',
    'git status',
    ['changes', 'modified', 'staged', 'dirty']
  ),
  e(
    'claude-compact',
    'any',
    'agents',
    'Shrink a long Claude conversation',
    'Typed inside Claude Code: summarises the conversation so far to free up context.',
    '/compact',
    ['compact', 'context full', 'summarise', 'running out of context', 'slash command']
  ),
  e(
    'claude-resume',
    'any',
    'agents',
    'Pick up a Claude conversation where it stopped',
    'Opens a list of earlier sessions for this folder.',
    'claude --resume',
    ['resume', 'continue', 'previous session', 'come back']
  ),
  e(
    'winget-install',
    'any',
    'packages',
    'Install a program',
    'Downloads and installs an application by name.',
    'winget install NAME',
    ['install', 'download app', 'apt install', 'brew', 'setup']
  )
]

const ids = (query: string, shell?: HelpShell, limit = 5): string[] =>
  searchHelp(FIXTURE, query, { shell, limit }).map((h) => h.entry.id)
const top = (query: string, shell?: HelpShell): string | undefined => ids(query, shell, 1)[0]

describe('tokenise', () => {
  it('lower-cases, strips punctuation and folds accents', () => {
    expect(tokenise('How do I find BIG files?!')).toEqual([
      'how',
      'do',
      'i',
      'find',
      'big',
      'files'
    ])
    expect(tokenise("what's using port 3000")).toEqual(['whats', 'using', 'port', '3000'])
    expect(tokenise('Get-ChildItem | Sort-Object')).toEqual(['get', 'childitem', 'sort', 'object'])
    expect(tokenise('café')).toEqual(['cafe'])
    expect(tokenise('  ')).toEqual([])
    expect(tokenise('🙂🙂 ???')).toEqual([])
  })
})

describe('meaningfulWords', () => {
  it('drops the scaffolding of a question', () => {
    expect(meaningfulWords('how do I find big files')).toEqual(['find', 'big', 'files'])
    expect(meaningfulWords('please, what is the way to delete a folder in my shell')).toEqual([
      'delete',
      'folder',
      'shell'
    ])
  })

  it('keeps the small words that carry meaning here', () => {
    for (const w of ['all', 'not', 'up', 'out', 'back', 'kill', 'who', 'where']) {
      expect(meaningfulWords(`the ${w} thing`)).toContain(w)
    }
  })

  it('falls back to every word when nothing else is left', () => {
    expect(meaningfulWords('how do i')).toEqual(['how', 'do', 'i'])
  })

  it('says each word once and is bounded', () => {
    expect(meaningfulWords('file file file')).toEqual(['file'])
    const many = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ')
    expect(meaningfulWords(many).length).toBeLessThanOrEqual(24)
  })
})

describe('stem', () => {
  it('folds plurals, -ing, -ed, -er and -est', () => {
    expect(stem('biggest')).toBe('big')
    // "newest files" is about what changed last, "new file" about making one.
    expect(stem('newest')).not.toBe('new')
    expect(stem('bigger')).toBe('big')
    expect(stem('largest')).toBe('large')
    expect(stem('files')).toBe('file')
    expect(stem('running')).toBe('run')
    expect(stem('deleted')).toBe('delete')
    expect(stem('deleting')).toBe('delete')
    expect(stem('directories')).toBe('directory')
    expect(stem('processes')).toBe('process')
    expect(stem('stopped')).toBe('stop')
    expect(stem('killed')).toBe('kill')
    expect(stem('renamed')).toBe('rename')
    expect(stem('moving')).toBe('move')
    expect(stem('copied')).toBe('copy')
    expect(stem('branches')).toBe('branch')
    expect(stem('using')).toBe('use')
  })

  it('leaves short words, command names and look-alikes alone', () => {
    for (const w of [
      'ls',
      'ps',
      'cls',
      'less',
      'rm',
      'dir',
      'dns',
      'status',
      'this',
      'alias',
      'process',
      'address'
    ]) {
      expect(stem(w)).toBe(w)
    }
    // Nouns that only look like comparatives or participles.
    for (const w of [
      'folder',
      'server',
      'user',
      'string',
      'test',
      'latest',
      'speed',
      'ping',
      'docker'
    ]) {
      expect(stem(w)).toBe(w)
    }
    expect(stem('sha256')).toBe('sha256')
  })
})

describe('expand', () => {
  it('knows the everyday vocabulary of a shell', () => {
    expect(expand('big')).toEqual(expect.arrayContaining(['large', 'huge', 'size']))
    expect(expand('remove')).toEqual(expect.arrayContaining(['delete', 'erase', 'rm', 'del']))
    expect(expand('directories')).toEqual(expect.arrayContaining(['folder', 'dir']))
    expect(expand('kill')).toEqual(expect.arrayContaining(['stop', 'end', 'terminate', 'quit']))
    expect(expand('sudo')).toEqual(expect.arrayContaining(['admin', 'administrator', 'elevated']))
    expect(expand('unzip')).toEqual(expect.arrayContaining(['extract', 'decompress']))
    expect(expand('unzip')).not.toContain('zip')
  })

  it('never lists the word itself, and has nothing for a stranger', () => {
    expect(expand('big')).not.toContain('big')
    expect(expand('kubernetes')).toEqual([])
    expect(expand('')).toEqual([])
  })

  it('reads "running" as a process without making "run" one', () => {
    expect(expand('running')).toContain('process')
    expect(expand('run')).toEqual([])
    expect(expand('process')).not.toContain('run')
  })
})

describe('withinOneEdit', () => {
  it('accepts one slip and no more', () => {
    expect(withinOneEdit('proccess', 'process')).toBe(true) // a letter too many
    expect(withinOneEdit('proces', 'process')).toBe(true) // one too few
    expect(withinOneEdit('direcotry', 'directory')).toBe(true) // two swapped
    expect(withinOneEdit('directary', 'directory')).toBe(true) // one wrong
    expect(withinOneEdit('dirctary', 'directory')).toBe(false)
    expect(withinOneEdit('process', 'process')).toBe(true)
  })
})

describe('searchHelp, the rankings', () => {
  it('"how do I find big files" lands on the biggest-files entry of the shell asked for', () => {
    expect(top('how do I find big files', 'powershell')).toBe('ps-biggest-files')
    expect(top('how do I find big files', 'bash')).toBe('bash-biggest-files')
    expect(top('what is taking up all the space', 'powershell')).toBe('ps-biggest-files')
    expect(top('largest file', 'powershell')).toBe('ps-biggest-files')
  })

  it('"whats using port 3000"', () => {
    expect(top('whats using port 3000', 'powershell')).toBe('ps-port-in-use')
    expect(top("what's using port 3000?", 'bash')).toBe('bash-port')
    expect(top('port already in use', 'cmd')).toBe('cmd-port')
    expect(top('EADDRINUSE', 'powershell')).toBe('ps-port-in-use')
  })

  it('"kill a process"', () => {
    expect(top('kill a process', 'powershell')).toBe('ps-kill-process')
    expect(top('kill a process', 'cmd')).toBe('cmd-kill')
    expect(top('kill a process', 'bash')).toBe('bash-kill')
    expect(top('program is frozen', 'powershell')).toBe('ps-kill-process')
  })

  it('"go back a folder"', () => {
    expect(top('go back a folder', 'powershell')).toBe('ps-up-one-folder')
    expect(top('go back a folder', 'bash')).toBe('bash-up')
    expect(top('how do i get out of this directory', 'powershell')).toBe('ps-up-one-folder')
  })

  it('"delete a folder"', () => {
    expect(top('delete a folder', 'powershell')).toBe('ps-delete-folder')
    expect(top('remove directory', 'cmd')).toBe('cmd-delete-folder')
    expect(top('erase a dir', 'bash')).toBe('bash-delete-folder')
    // The file entry is about deleting too, and must come after.
    const both = ids('delete a folder', 'powershell')
    expect(both.indexOf('ps-delete-folder')).toBeLessThan(both.indexOf('ps-delete-file'))
  })

  it('"grep" finds Select-String through its keywords, and grep itself in bash', () => {
    expect(top('grep', 'powershell')).toBe('ps-search-text')
    expect(top('grep', 'bash')).toBe('bash-grep')
    // With no shell named, the command called grep is the answer.
    expect(top('grep')).toBe('bash-grep')
    expect(ids('grep', 'bash')).toContain('bash-filter-output')
  })

  it('an exact command name puts that entry first', () => {
    expect(top('taskkill')).toBe('cmd-kill')
    expect(top('Get-ChildItem', 'powershell')).toBe('ps-list-files')
    expect(top('git status')).toBe('git-status')
    expect(top('less')).toBe('bash-less')
    expect(top('pwd')).toBe('bash-pwd')
    expect(top('/compact')).toBe('claude-compact')
    expect(top('/compact', 'powershell')).toBe('claude-compact')
    expect(top('/comp', 'cmd')).toBe('claude-compact') // still being typed
  })

  it('"undo last commit"', () => {
    expect(top('undo last commit')).toBe('git-undo-commit')
    expect(top('how can I undo my last commit', 'powershell')).toBe('git-undo-commit')
    expect(top('discard my changes', 'bash')).toBe('git-discard')
  })

  it('"unzip"', () => {
    expect(top('unzip', 'powershell')).toBe('ps-unzip')
    expect(top('unzip', 'bash')).toBe('bash-unzip')
    expect(top('extract a zip', 'powershell')).toBe('ps-unzip')
    expect(top('compress a folder', 'powershell')).toBe('ps-zip')
  })

  it('"where am i"', () => {
    expect(top('where am i', 'powershell')).toBe('ps-where-am-i')
    expect(top('where am I?', 'bash')).toBe('bash-pwd')
    expect(top('who am i', 'powershell')).toBe('ps-whoami')
  })

  it('"see hidden files"', () => {
    expect(top('see hidden files', 'powershell')).toBe('ps-hidden-files')
    expect(top('see hidden files', 'bash')).toBe('bash-hidden')
    expect(top('display invisible files', 'powershell')).toBe('ps-hidden-files')
  })

  it('other everyday phrasings', () => {
    expect(top('what is my ip', 'powershell')).toBe('ps-ip-address')
    expect(top('create a directory', 'powershell')).toBe('ps-make-folder')
    expect(top('run as admin', 'powershell')).toBe('ps-admin')
    expect(top('clean the screen', 'cmd')).toBe('cmd-clear')
    expect(top('previous commands', 'powershell')).toBe('ps-history')
    expect(top('duplicate a file', 'powershell')).toBe('ps-copy-file')
    expect(top('what is running', 'powershell')).toBe('ps-list-processes')
  })

  it('forgives one typo in a long word, and scores it below the real spelling', () => {
    expect(top('kill proccess', 'powershell')).toBe('ps-kill-process')
    expect(top('make a direcotry', 'powershell')).toBe('ps-make-folder')
    expect(top('hiden files', 'bash')).toBe('bash-hidden')
    const typo = searchHelp(FIXTURE, 'kill proccess', { shell: 'powershell' })[0]
    const right = searchHelp(FIXTURE, 'kill process', { shell: 'powershell' })[0]
    expect(typo.entry.id).toBe(right.entry.id)
    expect(typo.score).toBeLessThan(right.score)
  })

  it('a corrected typo brings its synonyms along', () => {
    // Nothing about zipping says "directory": the slip has to be read as
    // "directory" and THEN as "folder" for every word to have matched.
    const hit = searchHelp(FIXTURE, 'compress a direcotry', { shell: 'powershell' })[0]
    expect(hit.entry.id).toBe('ps-zip')
    expect(hit.score).toBeGreaterThanOrEqual(1000)
  })

  it('a short form is the same word as its long form', () => {
    expect(top('run as admin', 'powershell')).toBe('ps-admin')
    expect(top('run as administrator', 'powershell')).toBe('ps-admin')
    const short = searchHelp(FIXTURE, 'run as admin', { shell: 'powershell' })[0]
    const long = searchHelp(FIXTURE, 'run as administrator', { shell: 'powershell' })[0]
    expect(short.score).toBe(long.score)
    expect(top('env variable', 'powershell')).toBe('ps-env-var')
  })

  it('finds a word that is still being typed', () => {
    expect(top('unz', 'powershell')).toBe('ps-unzip')
    expect(ids('proc', 'powershell')).toContain('ps-list-processes')
  })

  it('ranks an entry matching every word above one matching only some', () => {
    const hits = searchHelp(FIXTURE, 'find big files', { shell: 'powershell' })
    const names = hits.map((h) => h.entry.id)
    expect(names[0]).toBe('ps-biggest-files')
    expect(names).toContain('ps-find-file-by-name') // matches "find" and "files" only
    expect(hits[0].score).toBeGreaterThan(hits[1].score)
  })

  it('breaks a tie by the shorter task, then by id', () => {
    const pair: HelpEntry[] = [
      e('b-two', 'any', 'files', 'Frobnicate a widget now', 'x', 'frob', ['zzz']),
      e('a-two', 'any', 'files', 'Frobnicate a widget now', 'x', 'frob', ['zzz']),
      e('c-one', 'any', 'files', 'Frobnicate a widget', 'x', 'frob', ['zzz'])
    ]
    expect(searchHelp(pair, 'frobnicate widget').map((h) => h.entry.id)).toEqual([
      'c-one',
      'a-two',
      'b-two'
    ])
  })
})

describe('searchHelp, the options', () => {
  it('an empty query is the catalogue of that shell, in catalogue order', () => {
    const all = searchHelp(FIXTURE, '')
    expect(all.map((h) => h.entry.id)).toEqual(FIXTURE.map((x) => x.id))
    expect(all.every((h) => h.score === 0)).toBe(true)

    const bash = searchHelp(FIXTURE, '   ', { shell: 'bash' })
    expect(bash.map((h) => h.entry.id)).toEqual(
      FIXTURE.filter((x) => x.shell === 'bash' || x.shell === 'any').map((x) => x.id)
    )
    expect(
      searchHelp(FIXTURE, '', { shell: 'bash', category: 'git' }).map((h) => h.entry.id)
    ).toEqual(['git-undo-commit', 'git-discard', 'git-log', 'git-status'])
    expect(searchHelp(FIXTURE, '', { limit: 3 })).toHaveLength(3)
  })

  it('the shell filter keeps that shell and "any", and nothing else', () => {
    for (const shell of ['powershell', 'cmd', 'bash'] as const) {
      for (const q of ['delete', 'port', 'files', 'git', 'kill', 'grep', 'ls', '']) {
        for (const h of searchHelp(FIXTURE, q, { shell })) {
          expect([shell, 'any']).toContain(h.entry.shell)
        }
      }
    }
    expect(
      searchHelp(FIXTURE, 'commit', { shell: 'any' }).every((h) => h.entry.shell === 'any')
    ).toBe(true)
  })

  it('the category filter and the limit', () => {
    const hits = searchHelp(FIXTURE, 'folder', { shell: 'powershell', category: 'folders' })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((h) => h.entry.category === 'folders')).toBe(true)
    expect(searchHelp(FIXTURE, 'file', { limit: 2 })).toHaveLength(2)
    // A limit that makes no sense is no limit.
    expect(searchHelp(FIXTURE, 'file', { limit: -1 }).length).toBeGreaterThan(2)
    expect(searchHelp(FIXTURE, 'file', { limit: Number.NaN }).length).toBeGreaterThan(2)
  })

  it('a query that matches nothing is an empty list, not the catalogue', () => {
    expect(searchHelp(FIXTURE, 'xylophone quokka')).toEqual([])
    expect(searchHelp(FIXTURE, '???')).toEqual([])
    expect(searchHelp(FIXTURE, '🙂')).toEqual([])
  })
})

describe('searchHelp, whatever it is handed', () => {
  const JUNK: string[] = [
    '',
    ' ',
    '\n\t',
    '🙂🔥💾',
    '\ud800', // a lone surrogate
    '.*+?^${}()|[]\\',
    '(((((',
    '[a-z]+$',
    '\\',
    '%PATH% && del /s /q C:\\*',
    '<script>alert(1)</script>',
    "'; DROP TABLE help; --",
    'a'.repeat(5000),
    'find big files '.repeat(400),
    '١٢٣ файлы 大きい ファイル',
    '__proto__ constructor toString hasOwnProperty',
    '-',
    '/',
    '0',
    'ﬁle'
  ]

  it('never throws, and always answers with unique entries in score order', () => {
    for (const q of JUNK) {
      for (const shell of [undefined, 'powershell', 'bash', 'cmd', 'any'] as const) {
        let hits: ReturnType<typeof searchHelp> = []
        expect(() => {
          hits = searchHelp(FIXTURE, q, { shell })
        }).not.toThrow()
        expect(new Set(hits.map((h) => h.entry.id)).size).toBe(hits.length)
        for (let i = 1; i < hits.length; i++)
          expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score)
        for (const h of hits) expect(Number.isFinite(h.score)).toBe(true)
      }
    }
  })

  it('survives input that is not what the types promise', () => {
    const bad = [
      { id: 'x', shell: 'any', category: 'files' },
      null,
      {
        id: 'y',
        shell: 'any',
        category: 'files',
        task: 'Find a thing',
        keywords: 'nope',
        variants: 7
      }
    ] as unknown as HelpEntry[]
    expect(() => searchHelp(bad, 'find thing')).not.toThrow()
    expect(() => searchHelp(undefined as unknown as HelpEntry[], 'x')).not.toThrow()
    expect(() => searchHelp(FIXTURE, undefined as unknown as string)).not.toThrow()
    expect(() =>
      searchHelp(FIXTURE, 42 as unknown as string, null as unknown as undefined)
    ).not.toThrow()
    expect(searchHelp([], 'anything')).toEqual([])
  })

  it('does not read a word off the prototype as a hit', () => {
    expect(searchHelp(FIXTURE, 'constructor')).toEqual([])
    expect(searchHelp(FIXTURE, '__proto__')).toEqual([])
  })

  it('scores are sorted and results unique for every real phrasing too', () => {
    for (const q of ['how do I find big files', 'kill', 'git', 'folder', 'show', 'a', 'the']) {
      const hits = searchHelp(FIXTURE, q)
      expect(new Set(hits.map((h) => h.entry)).size).toBe(hits.length)
      for (let i = 1; i < hits.length; i++)
        expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score)
    }
  })

  it('is stable: the same question gets the same answer', () => {
    const a = searchHelp(FIXTURE, 'delete files in a folder').map((h) => h.entry.id)
    const b = searchHelp([...FIXTURE].reverse(), 'delete files in a folder').map((h) => h.entry.id)
    expect(b).toEqual(a)
  })
})

describe('searchHelp, the cost', () => {
  // The catalogue is a few hundred entries and the panel searches on every
  // keystroke, so this is measured rather than hoped for.
  const big = (): HelpEntry[] =>
    Array.from({ length: 300 }, (_, i) => {
      const src = FIXTURE[i % FIXTURE.length]
      return {
        ...src,
        id: `${src.id}-${i}`,
        task: `${src.task} number ${i}`,
        keywords: [...src.keywords, `variant${i}`, `extra word ${i % 17}`]
      }
    })
  const LONG =
    'how do I find the biggest and largest files in my folders and then delete the hidden ones that are not running ' +
    'as a process on port 3000 while I undo my last commit and unzip the archive please, also direcotry and proccess ' +
    'and whatever elze might be taking up all the space on this machine right now because the disk is completely full'

  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

  it('300 entries and a long question: a keystroke stays under 20 ms, and the first one under 150', () => {
    // Cold: a catalogue this function has never seen, so the index is built.
    const cold: number[] = []
    for (let i = 0; i < 5; i++) {
      const entries = big()
      const t = performance.now()
      const hits = searchHelp(entries, LONG)
      cold.push(performance.now() - t)
      expect(hits.length).toBeGreaterThan(0)
    }
    // Warm: the same array again, which is what every keystroke after the
    // first one is.
    const entries = big()
    searchHelp(entries, LONG)
    const warm: number[] = []
    for (let i = 0; i < 20; i++) {
      const t = performance.now()
      searchHelp(entries, `${LONG} ${i}`)
      warm.push(performance.now() - t)
    }
    console.log(
      `searchHelp 300 entries: cold median ${median(cold).toFixed(2)} ms, warm median ${median(warm).toFixed(2)} ms`
    )
    // WARM is the number that matters: it is every keystroke. COLD happens once
    // per run of the app, when the popup is first opened, and its bound is
    // looser ON PURPOSE: measured at 4.9 ms on the machine this was written on
    // and at 21.8 ms on a shared CI runner with the rest of the suite running
    // beside it, where a 20 ms bound failed the build over nothing a person
    // could feel. It is here to catch an index that has gone quadratic, which
    // would miss 150 ms by a mile, not to benchmark the runner.
    expect(median(warm)).toBeLessThan(20)
    expect(median(cold)).toBeLessThan(150)
  })
})
