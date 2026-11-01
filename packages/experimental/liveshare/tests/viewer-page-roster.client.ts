/**
 * Test-only client roster of the assembled viewer page.
 *
 * A served viewer page is the owner's own Web shell with the owner's client plugins; this roster is the
 * subset the viewer page specs need: the wire plugin, the Gateway, remote access, the Session/Workspace controllers,
 * the presentation plugins, and the Liveshare `./client` face, which mounts the viewer surfaces when the
 * carrier names a share. Every row is the package's own `/client` face registered as a module-table
 * factory. It must be imported only after {@link prepareViewerRemoteFaces} answered the generated
 * `/remote` faces these plugins import.
 *
 * @module @liwa/experimental-liveshare/tests/viewer-page-roster
 */

import * as apiGateway from '@liwa/api-gateway/client'
import * as apiRemoteAccess from '@liwa/api-remote-access/client'
import * as apiRemotes from '@liwa/api-remotes/client'
import * as apiSessionController from '@liwa/api-session-controller/client'
import * as apiWorkspaceController from '@liwa/api-workspace-controller/client'
import * as clientConnection from '@liwa/client-connection/client'
import * as clientFileUpload from '@liwa/client-file-upload/client'
import * as clientLocale from '@liwa/client-locale/client'
import * as clientModules from '@liwa/client-modules/client'
import * as clientResources from '@liwa/client-resources/client'
import * as clientShortcuts from '@liwa/client-shortcuts/client'
import * as uiAttachment from '@liwa/client-ui-attachment/client'
import * as uiChat from '@liwa/client-ui-chat/client'
import * as uiConversation from '@liwa/client-ui-conversation/client'
import * as uiDeliverables from '@liwa/client-ui-deliverables/client'
import * as uiFileDrag from '@liwa/client-ui-file-drag/client'
import * as uiLayout from '@liwa/client-ui-layout/client'
import * as uiRenderer from '@liwa/client-ui-renderer/client'
import * as uiSession from '@liwa/client-ui-session/client'
import * as uiSettings from '@liwa/client-ui-settings/client'
import * as uiSidebar from '@liwa/client-ui-sidebar/client'
import * as uiSidebarRight from '@liwa/client-ui-sidebar-right/client'
import * as uiTheme from '@liwa/client-ui-theme/client'
import * as uiTool from '@liwa/client-ui-tool/client'
import * as uiTrajectory from '@liwa/client-ui-trajectory/client'
import * as uiWorkspace from '@liwa/client-ui-workspace/client'
import * as typertRegistry from '@liwa/typert-registry/client'
import * as liveshare from '../src/client/index.ts'

/** One module-table row: the entry id the Loader creates, and that plugin's client exports. */
export interface ViewerPageRosterRow {
  readonly id: string
  readonly exports: Readonly<Record<string, unknown>>
}

/** Entry id of the module-system bootstrap whose exports the facade hands to the module system. */
export const VIEWER_PAGE_BOOTSTRAP_ID = '@liwa/client-modules'

/** The viewer page roster; Cordis composes these entries by service injection, so order is irrelevant. */
export const VIEWER_PAGE_ROSTER: readonly ViewerPageRosterRow[] = [
  { id: '@liwa/typert-registry', exports: typertRegistry },
  { id: '@liwa/experimental-liveshare', exports: liveshare },
  { id: VIEWER_PAGE_BOOTSTRAP_ID, exports: clientModules },
  { id: '@liwa/client-connection', exports: clientConnection },
  { id: '@liwa/api-gateway', exports: apiGateway },
  { id: '@liwa/api-remote-access', exports: apiRemoteAccess },
  { id: '@liwa/api-remotes', exports: apiRemotes },
  { id: '@liwa/api-session-controller', exports: apiSessionController },
  { id: '@liwa/api-workspace-controller', exports: apiWorkspaceController },
  { id: '@liwa/client-file-upload', exports: clientFileUpload },
  { id: '@liwa/client-locale', exports: clientLocale },
  { id: '@liwa/client-resources', exports: clientResources },
  { id: '@liwa/client-shortcuts', exports: clientShortcuts },
  { id: '@liwa/client-ui-renderer', exports: uiRenderer },
  { id: '@liwa/client-ui-theme', exports: uiTheme },
  { id: '@liwa/client-ui-settings', exports: uiSettings },
  { id: '@liwa/client-ui-layout', exports: uiLayout },
  { id: '@liwa/client-ui-session', exports: uiSession },
  { id: '@liwa/client-ui-sidebar', exports: uiSidebar },
  { id: '@liwa/client-ui-conversation', exports: uiConversation },
  { id: '@liwa/client-ui-chat', exports: uiChat },
  { id: '@liwa/client-ui-tool', exports: uiTool },
  { id: '@liwa/client-ui-attachment', exports: uiAttachment },
  { id: '@liwa/client-ui-file-drag', exports: uiFileDrag },
  { id: '@liwa/client-ui-sidebar-right', exports: uiSidebarRight },
  { id: '@liwa/client-ui-trajectory', exports: uiTrajectory },
  { id: '@liwa/client-ui-deliverables', exports: uiDeliverables },
  { id: '@liwa/client-ui-workspace', exports: uiWorkspace },
]
