import { Hono } from 'hono';
import { config } from '../config';
import { previewProxyAuth } from '../middleware/auth';
import { preview } from './routes/preview';
import { localPreview } from './routes/local-preview';

const daytonaProxyApp = new Hono();

// Unified auth: accepts Supabase JWT and sbt_ sandbox tokens.
// No more mode-split — works for cloud, local, and VPS alike.
daytonaProxyApp.use('/:sandboxId/:port/*', previewProxyAuth);
daytonaProxyApp.use('/:sandboxId/:port', previewProxyAuth);

// Mount handler based on whether the provider supports Daytona.
// local_docker: proxy directly to sandbox containers via Docker DNS.
// daytona: proxy through Daytona SDK preview links.
//
// When ALLOWED_SANDBOX_PROVIDERS includes daytona, use the Daytona proxy
// (which also handles ownership verification via the DB).
// Otherwise use the local Docker proxy (direct container DNS).
if (config.isDaytonaEnabled()) {
  daytonaProxyApp.route('/', preview);
} else {
  daytonaProxyApp.route('/', localPreview);
}

export { daytonaProxyApp };
