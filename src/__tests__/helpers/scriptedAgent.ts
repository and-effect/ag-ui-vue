import { AbstractAgent, EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/client'
import { Observable, from } from 'rxjs'

/**
 * A real `@ag-ui/client` agent whose run replays a fixed event list.
 *
 * Unlike `MockHttpAgent`, events go through the client's own verify/apply
 * pipeline, so tests see exactly what the client materialises into
 * `agent.messages` and hands its subscribers. Use it where the claim under test
 * is about the client's behaviour (patch application, `replace`, buffers,
 * encryptedValue) rather than our composable's handling of a given callback.
 *
 * `RUN_STARTED` / `RUN_FINISHED` are added around `events`.
 */
export class ScriptedAgent extends AbstractAgent {
  /** The input of every run, in order. */
  inputs: RunAgentInput[] = []

  constructor(public events: object[] = []) {
    super()
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.inputs.push(input)
    const { threadId, runId } = input
    return from([
      { type: EventType.RUN_STARTED, threadId, runId },
      ...this.events.map((e) => ({ ...e })),
      { type: EventType.RUN_FINISHED, threadId, runId },
    ] as BaseEvent[])
  }
}

export { EventType }
