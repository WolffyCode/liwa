// 人造 stream-json CLI；所有帧只用于 SDK/受管进程回环，不调用任何模型。
import { createInterface } from 'node:readline'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, realpathSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

if (process.argv.includes('--version')) {
  process.stdout.write('2.1.318 (Claude Code)\n')
  process.exit(0)
}
const has = name => process.argv.some(value => value === name || value.startsWith(`${name}=`))
const arg = name => process.argv.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? process.argv[process.argv.indexOf(name) + 1]
const pluginCommands = () => {
  const commands = []
  const walk = (directory, prefix) => {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(directory, entry.name), `${prefix}${entry.name}:`)
      else if (entry.name.endsWith('.md')) commands.push({ name: `${prefix}${entry.name.slice(0, -3)}`, description: 'Managed command', argumentHint: '' })
    }
  }
  for (let index = 0; index < process.argv.length; index++) {
    if (process.argv[index] !== '--plugin-dir') continue
    const directory = process.argv[index + 1]
    const manifest = JSON.parse(readFileSync(join(directory, '.claude-plugin', 'plugin.json'), 'utf8'))
    walk(join(directory, 'commands'), `${manifest.name}:`)
  }
  return commands
}
const session = has('--resume') ? arg('--resume') : randomUUID()
let model = process.argv.includes('--model') ? arg('--model') : 'mock'
let mode = process.argv.includes('--permission-mode') ? arg('--permission-mode') : 'default'
let turn = null
let cumulative = 0
const modelUsage = {}
let background
let retrying
const frameUsage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 }
const partial = event => emit({ type: 'stream_event', uuid: randomUUID(), session_id: session, parent_tool_use_id: null, event })
let initHooks = {}
const pending = new Map()
const started = new Set()
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`)
const system = (subtype, facts = {}) => emit({ type: 'system', subtype, session_id: session, uuid: randomUUID(), ...facts })
const init = () => system('init', { cwd: process.cwd(), model, permissionMode: mode, claude_code_version: '2.1.318', tools: ['Read'], mcp_servers: [], apiKeySource: 'env', slash_commands: [], output_style: 'default', agents: [], skills: [], plugins: [] })
const project = join(process.env.CLAUDE_CONFIG_DIR, 'projects', realpathSync(process.cwd()).normalize('NFC').replace(/[^a-zA-Z0-9]/g, '-'))
mkdirSync(project, { recursive: true })
const stateFile = join(project, `${session}.jsonl`)
const captureFile = join(process.env.CLAUDE_CONFIG_DIR, `${session}.capture.json`)
const capture = () => writeFileSync(captureFile, JSON.stringify({
  model, mode,
  args: process.argv.slice(2), home: process.env.HOME, configDir: process.env.CLAUDE_CONFIG_DIR,
  secureStorage: process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR, baseUrl: process.env.ANTHROPIC_BASE_URL,
  authVariables: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'].filter(name => process.env[name] !== undefined),
  authType: process.env.ANTHROPIC_API_KEY ? 'api-key' : 'auth-token',
  authHash: createHash('sha256').update(process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN ?? '').digest('hex'),
  extraHash: createHash('sha256').update(process.env.ANTHROPIC_CUSTOM_HEADERS ?? '').digest('hex'),
  env: Object.fromEntries(['ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL', 'API_TIMEOUT_MS'].filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]])),
}))
capture()
let prior = ''
let resumeError
if (has('--resume')) {
  try { prior = readFileSync(stateFile, 'utf8') } catch (error) { resumeError = error.code === 'ENOENT' ? `No conversation found with session ID: ${session}` : 'Native transcript unreadable' }
  // 真 CLI 续接时从转录恢复累计用量与成本：每个已完成回合（一条 user 行）算一次。
  for (const line of prior.split('\n')) if (line.includes('"type":"user"')) advanceUsage()
}
function advanceUsage() {
  cumulative += 10
  const count = (modelUsage[model]?.inputTokens ?? 0) + 10
  modelUsage[model] = { inputTokens: count, outputTokens: count / 2, cacheReadInputTokens: count * 0.3, cacheCreationInputTokens: count * 0.2, costUSD: count / 1000, contextWindow: 200000, maxOutputTokens: 10000, webSearchRequests: 0 }
}
const response = (message, result = {}) => emit({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: result } })
const request = req => new Promise(resolve => {
  const id = randomUUID()
  pending.set(id, resolve)
  emit({ type: 'control_request', request_id: id, request: req })
})
const assistant = text => emit({ type: 'assistant', uuid: randomUUID(), session_id: session, parent_tool_use_id: null, message: { id: randomUUID(), type: 'message', role: 'assistant', model, content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: frameUsage } })
const tool = (name, id, input) => emit({ type: 'assistant', uuid: randomUUID(), session_id: session, parent_tool_use_id: null, message: { id: randomUUID(), type: 'message', role: 'assistant', model, content: [{ type: 'tool_use', id, name, input }], usage: { ...frameUsage, output_tokens: 0 } } })
const toolResult = (id, ok, content) => emit({ type: 'user', uuid: randomUUID(), session_id: session, parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: content ?? (ok ? 'done' : 'denied'), is_error: !ok }] } })
function streamReply() {
  const id = randomUUID()
  const message = { id, type: 'message', role: 'assistant', model, content: [], usage: { ...frameUsage, output_tokens: 0 }, stop_reason: null }
  partial({ type: 'message_start', message })
  partial({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } })
  for (const thinking of ['reason-', 'stream']) partial({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } })
  partial({ type: 'content_block_stop', index: 0 })
  partial({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } })
  for (const text of ['text-', 'stream']) partial({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text } })
  partial({ type: 'content_block_stop', index: 1 })
  partial({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'stream-tool', name: 'Read', input: {} } })
  for (const partial_json of ['{"file_', 'path":"/stream.txt"}']) partial({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json } })
  partial({ type: 'content_block_stop', index: 2 })
  partial({ type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } })
  partial({ type: 'message_stop' })
  emit({ type: 'assistant', uuid: randomUUID(), session_id: session, parent_tool_use_id: null, message: { ...message, usage: frameUsage, stop_reason: 'tool_use', content: [{ type: 'thinking', thinking: 'reason-stream', signature: 'sig' }, { type: 'text', text: 'text-stream' }, { type: 'tool_use', id: 'stream-tool', name: 'Read', input: { file_path: '/stream.txt' } }] } })
  toolResult('stream-tool', true)
}
function result(error, unknown = false, zero = false) {
  if (!turn) return
  if (!zero) advanceUsage()
  emit({ type: 'result', subtype: error ? 'error_during_execution' : 'success', session_id: session, uuid: randomUUID(), duration_ms: 1, duration_api_ms: 1, is_error: Boolean(error), num_turns: zero ? 0 : 1, total_cost_usd: zero ? 0 : cumulative / 1000, stop_reason: error ? null : 'end_turn', usage: { input_tokens: zero ? 0 : 10, output_tokens: zero ? 0 : 5, cache_read_input_tokens: zero ? 0 : 3, cache_creation_input_tokens: zero ? 0 : 2 }, modelUsage: unknown || zero ? {} : modelUsage, permission_denials: [], ...(error ? { errors: [error] } : { result: 'done' }) })
  turn = null
}
function childStart(bg = false) {
  system('task_started', { task_id: 'native-task', tool_use_id: 'child-tool', task_type: 'local_agent', subagent_type: 'general-purpose', description: 'Worker', prompt: 'help', is_backgrounded: bg })
  if (bg) system('background_tasks_changed', { tasks: [{ task_id: 'native-task', task_type: 'local_agent', status: 'running' }] })
}
function childEnd(status = 'completed') {
  system('background_tasks_changed', { tasks: [] })
  system('task_notification', { task_id: 'native-task', tool_use_id: 'child-tool', status, output_file: '', summary: 'Child finished', usage: { total_tokens: 123 } })
}
async function hook(name, input) {
  let output = {}
  for (const matcher of initHooks[name] ?? []) {
    for (const callback_id of matcher.hookCallbackIds) {
      const decision = await request({ subtype: 'hook_callback', callback_id, tool_use_id: input.tool_use_id, input: { hook_event_name: name, session_id: session, transcript_path: stateFile, cwd: process.cwd(), ...input } })
      output = { ...output, ...decision }
    }
  }
  return output
}
async function run(message) {
  const blocks = typeof message.message.content === 'string' ? [{ type: 'text', text: message.message.content }] : message.message.content
  const text = blocks.filter(block => block.type === 'text').map(block => block.text).join('\n')
  if (message.priority === 'next' && turn) {
    assistant(`steered: ${text}`)
    return
  }
  turn = message.uuid
  started.add(message.uuid)
  init()
  system('command_lifecycle', { command_id: message.uuid, state: 'started', source: 'sdk' })
  const scenario = /scenario:([\w-]+)/.exec(text)?.[1] ?? 'reply'
  if (resumeError) { result(resumeError, false, true); return }
  if (scenario === 'long') { partial({ type: 'message_start', message: { id: randomUUID(), type: 'message', role: 'assistant', model, content: [], usage: { ...frameUsage, output_tokens: 0 }, stop_reason: null } }); return }
  if (scenario === 'api-retry-401') {
    let attempt = 0
    retrying = setInterval(() => { attempt += 1; system('api_retry', { attempt, max_retries: 10, retry_delay_ms: 50, error_status: 401, error: 'authentication_failed' }) }, 20)
    return
  }
  if (scenario === 'crash') { process.stderr.write('fixture runtime failure\n'); process.exit(2) }
  if (scenario === 'compact') {
    const trigger = process.env.LIWA_TEST_COMPACT_TRIGGER
    system('compact_boundary', { compact_metadata: { ...(trigger === 'unknown' ? {} : { trigger }), pre_tokens: 100, post_tokens: 20 } })
    result()
    return
  }
  if (scenario === 'mcp-secret-error') {
    tool('mcp__docs__check', 'mcp-failed', {})
    toolResult('mcp-failed', false, `MCP refused ${process.env.LIWA_TEST_ECHO}`)
    result()
    return
  }
  if (scenario === 'secret-error') {
    const secret = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN
    await new Promise(resolve => process.stderr.write(`error ${secret.slice(0, 4)}`, resolve))
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => process.stderr.write(`${secret.slice(4)} ${process.env.ANTHROPIC_CUSTOM_HEADERS ?? ''} ${process.env.LIWA_TEST_ECHO ?? ''}\n`, resolve))
    result(`authentication failed ${secret}`)
    return
  }
  if (scenario === 'stream') { streamReply(); result(); return }
  if (scenario === 'project-context') {
    const input = { file_path: join(process.cwd(), 'nested', 'example.ts') }
    const context = await hook('PreToolUse', { tool_name: 'Read', tool_use_id: 'project-read', tool_input: input })
    assistant(context.hookSpecificOutput?.additionalContext ?? 'missing project context')
    result()
    return
  }
  if (scenario === 'unknown') { result(undefined, true); return }
  if (scenario === 'zero-crash' || scenario === 'zero-startup') { result(`${scenario} original failure`, false, true); return }
  if (scenario === 'fail') { partial({ type: 'message_start', message: { id: randomUUID(), type: 'message', role: 'assistant', model, content: [], usage: { ...frameUsage, output_tokens: 0 }, stop_reason: null } }); result('Provider failure'); return }
  if (scenario === 'background') {
    childStart(true)
    background = setTimeout(() => {
      childEnd()
      turn = randomUUID()
      init()
      assistant('background result')
      result()
    }, 300)
    return
  }
  if (scenario === 'conclude' || scenario === 'conclude-fail') {
    const call = { tool_name: 'mcp__liwa__report', tool_use_id: 'report-1', tool_input: {} }
    tool(call.tool_name, call.tool_use_id, call.tool_input)
    await hook('PreToolUse', call)
    const ok = scenario === 'conclude'
    toolResult(call.tool_use_id, ok)
    if (ok) await hook('PostToolUse', { ...call, tool_response: { ok: true } })
    else await hook('PostToolUseFailure', { ...call, error: 'tool failed' })
    const batch = await hook('PostToolBatch', { tool_calls: [call] })
    if (batch.continue !== false) assistant('continued')
    result()
    return
  }
  if (scenario === 'child' || scenario === 'child-permission') childStart()
  if (['native-permission', 'permission', 'child-permission', 'child-early', 'child-late', 'child-missing', 'question', 'question-multi'].includes(scenario)) {
    const question = scenario.startsWith('question')
    const isChild = scenario.startsWith('child-')
    const name = question ? 'AskUserQuestion' : scenario === 'native-permission' ? 'Bash' : 'mcp__liwa__report'
    const input = question ? { questions: [{ header: 'Choice', question: 'Which color?', options: [{ label: 'Red', description: 'red' }, { label: 'Blue', description: 'blue' }], multiSelect: scenario === 'question-multi' }] } : { value: 'child-permission-mark' }
    const id = randomUUID()
    tool(name, id, input)
    const gate = await hook('PreToolUse', { tool_name: name, tool_input: input, tool_use_id: id, ...(isChild ? { agent_id: 'native-task' } : {}) })
    const answerPending = gate.hookSpecificOutput?.permissionDecision === 'allow'
      ? { behavior: 'allow', updatedInput: input }
      : request({ subtype: 'can_use_tool', tool_name: name, input, tool_use_id: id, permission_suggestions: scenario === 'native-permission' ? [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' }] : [], ...(isChild ? { agent_id: 'native-task' } : {}) })
    if (scenario === 'child-early') childStart()
    const answer = await answerPending
    if (scenario === 'child-late') childStart()
    if (!turn) return
    if (answer.interrupt) { result('Request aborted'); return }
    const allowed = answer.behavior === 'allow'
    toolResult(id, allowed)
    if (question && allowed) assistant(Object.values(answer.updatedInput.answers).join(' '))
    else assistant(allowed ? 'allowed' : 'denied')
  } else if (scenario === 'tool') {
    tool('Read', 'read-1', { file_path: '/example' })
    toolResult('read-1', true)
  } else if (scenario === 'api-retry-529') {
    for (const attempt of [1, 2]) system('api_retry', { attempt, max_retries: 10, retry_delay_ms: 10, error_status: 529, error: 'overloaded' })
    assistant('recovered')
  } else if (scenario === 'image') assistant(blocks.find(block => block.type === 'image')?.source.media_type ?? 'missing')
  else assistant(`reply ${text} ${prior}`)
  if (['child', 'child-permission', 'child-early', 'child-late'].includes(scenario)) childEnd()
  prior += `${JSON.stringify({ type: 'user', uuid: randomUUID(), sessionId: session, message: { role: 'user', content: text } })}\n`
  writeFileSync(stateFile, prior)
  result()
}

createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line)
  if (message.type === 'control_response') {
    const callback = pending.get(message.response.request_id)
    pending.delete(message.response.request_id)
    callback?.(message.response.response)
    return
  }
  if (message.type === 'user') { void run(message); return }
  if (message.type !== 'control_request') return
  const req = message.request
  switch (req.subtype) {
    case 'initialize':
      initHooks = req.hooks ?? {}
      response(message, { commands: pluginCommands(), models: [{ value: 'mock', displayName: 'Mock', description: '' }, { value: 'mock-other', displayName: 'Other', description: '' }], account: {}, output_style: 'default', available_output_styles: ['default'] })
      break
    case 'set_model':
      if (process.env.LIWA_TEST_CONTROL_FAILURE === 'yes') emit({ type: 'control_response', response: { subtype: 'error', request_id: message.request_id, error: `control failed ${process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN}` } })
      else { model = req.model; capture(); response(message) }
      break
    case 'set_permission_mode': mode = req.mode; capture(); response(message); break
    case 'cancel_async_message':
      if (process.env.LIWA_TEST_WITHDRAW_FAIL === 'yes') emit({ type: 'control_response', response: { subtype: 'error', request_id: message.request_id, error: 'withdraw failed' } })
      else response(message, { cancelled: !started.has(req.message_uuid) })
      break
    case 'interrupt':
      clearInterval(retrying)
      if (process.env.LIWA_TEST_INTERRUPT_FAIL === 'yes') emit({ type: 'control_response', response: { subtype: 'error', request_id: message.request_id, error: 'interrupt failed' } })
      else if (process.env.LIWA_TEST_CANCEL_ORDER === 'no-result') response(message)
      else if (process.env.LIWA_TEST_CANCEL_ORDER === 'response-first') { response(message); setImmediate(() => result('Request aborted')) }
      else { result('Request aborted'); response(message) }
      break
    case 'stop_task': clearTimeout(background); childEnd('stopped'); response(message); break
    default: response(message)
  }
}).on('close', () => { clearTimeout(background); clearInterval(retrying); process.exit(0) })
