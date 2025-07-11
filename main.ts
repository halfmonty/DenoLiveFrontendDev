// Configuration
const CONFIG = {
  port: 8000,
  publicDir: './public',
  watchDir: './src',
  buildOutput: './public/js',
  entryPoint: './src/main.ts',
  debounceMs: 100,
} as const;

// MIME types for file serving
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
} as const;

// Types
interface BuildResult {
  success: boolean;
  output?: string;
  error?: string;
}

interface ReloadResponse {
  success: boolean;
  clients: number;
}

// Global state
const reloadConnections = new Set<WebSocket>();

// Utility functions
function getContentType(filePath: string): string {
  const ext = filePath.substring(filePath.lastIndexOf('.'));
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function isPathSecure(pathname: string): boolean {
  return !pathname.includes('..') && !pathname.startsWith('/');
}

function normalizePath(pathname: string): string {
  // Remove leading slash and decode URI
  pathname = decodeURIComponent(pathname.slice(1));
  
  // Default to index.html if no path or path ends with /
  if (!pathname || pathname.endsWith('/')) {
    pathname = pathname + 'index.html';
  }
  
  return pathname;
}

// File serving
async function serveFile(filePath: string): Promise<Response> {
  try {
    const file = await Deno.open(filePath, { read: true });
    const fileInfo = await file.stat();
    const body = file.readable;
    
    return new Response(body, {
      headers: {
        'Content-Type': getContentType(filePath),
        'Content-Length': fileInfo.size.toString(),
        // 'Cache-Control': `public, max-age=${CONFIG.cacheMaxAge}`,
      },
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return new Response('File not found', { status: 404 });
    }
    console.error('Error serving file:', error);
    return new Response('Internal server error', { status: 500 });
  }
}

// WebSocket handling for live reload
function handleWebSocket(request: Request): Response {
  if (request.headers.get('upgrade') !== 'websocket') {
    return new Response(null, { status: 501 });
  }

  const { socket, response } = Deno.upgradeWebSocket(request);

  socket.onopen = () => {
    console.log('🤝 Live reload client connected');
    reloadConnections.add(socket);
  };

  socket.onmessage = (event) => {
    if (event.data === 'ping') {
      socket.send('pong');
    }
  };

  socket.onclose = () => {
    console.log('👋 Live reload client disconnected');
    reloadConnections.delete(socket);
  };

  socket.onerror = (error) => {
    console.error('🤷‍♂️ Live reload WebSocket error:', error);
    reloadConnections.delete(socket);
  };

  return response;
}

// API handlers
function handleReloadApi(_request: Request): Response {
  console.log(`👍 Triggering reload for ${reloadConnections.size} clients`);
  
  reloadConnections.forEach((ws) => {
    try {
      ws.send('reload');
    } catch (error) {
      console.error(`🚩 Error sending reload signal: ${error}`);
      reloadConnections.delete(ws);
    }
  });
  
  const response: ReloadResponse = {
    success: true,
    clients: reloadConnections.size,
  };
  
  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Build system
async function bundleFile(entryPoints: string[], outdir: string): Promise<BuildResult> {
  try {
    const command = new Deno.Command('deno', {
      args: [
        'bundle',
        '--external',
        'https://esm.sh/phaser@4.0.0-rc.4',
        ...entryPoints,
        '--outdir',
        outdir,
      ],
      stdout: 'piped',
      stderr: 'piped',
    });

    const { code, stdout, stderr } = await command.output();

    const stdoutText = new TextDecoder().decode(stdout);
    const stderrText = new TextDecoder().decode(stderr);

    if (code === 0) {
      console.log('Bundle created successfully!');
      console.log('Output:', stdoutText);
      return { success: true, output: stdoutText };
    } else {
      console.error('Bundle failed with exit code:', code);
      console.error('Error:', stderrText);
      return { success: false, error: stderrText };
    }
  } catch (error) {
    console.error('Failed to execute deno bundle:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function triggerReload(): Promise<void> {
  try {
    const response = await fetch(`http://localhost:${CONFIG.port}/api/reload`, {
      method: 'GET',
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`🔁 Reload triggered for ${data.clients} clients`);
    }
  } catch (_error) {
    // Server might not be running yet, ignore the error
    console.log('🤷‍♂️ Could not trigger reload (server not ready)');
  }
}

async function buildGame(): Promise<void> {
  try {
    console.log('🔨 Building game...');

    const result = await bundleFile([CONFIG.entryPoint], CONFIG.buildOutput);

    if (result.success) {
      console.log('✅ Build complete!');
      // Trigger reload if this is a rebuild (not initial build)
      if (Deno.args.includes('--reload')) {
        await triggerReload();
      }
    } else {
      console.error('❌ Build failed:', result.error);
      Deno.exit(1);
    }
  } catch (error) {
    console.error('❌ Build failed:', error);
    Deno.exit(1);
  }
}

// Watch mode
async function startWatchMode(): Promise<void> {
  console.log('👀 Starting watch mode...');

  // Initial build
  await buildGame();

  // Watch for file changes
  const watcher = Deno.watchFs([CONFIG.watchDir], { recursive: true });
  let buildTimeout: number | null = null;

  for await (const event of watcher) {
    const isTypeScriptFile = event.paths.some((path) => path.endsWith('.ts'));
    
    if (event.kind === 'modify' && isTypeScriptFile) {
      console.log('📝 File changed:', event.paths);

      // Debounce builds
      if (buildTimeout) {
        clearTimeout(buildTimeout);
      }

      buildTimeout = setTimeout(async () => {
        console.log('🔨 Rebuilding...');
        await buildGame();
        console.log('✅ Rebuild complete!');
        await triggerReload();
      }, CONFIG.debounceMs);
    }
  }
}

// Main request handler
async function requestHandler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  let pathname = url.pathname;

  // Handle WebSocket upgrade for live reload
  if (pathname === '/ws/reload') {
    return handleWebSocket(request);
  }

  // Handle reload API
  if (pathname === '/api/reload') {
    return handleReloadApi(request);
  }

  // Normalize and validate file path
  pathname = normalizePath(pathname);

  // Security: prevent directory traversal
  if (!isPathSecure(pathname)) {
    return new Response('Forbidden', { status: 403 });
  }

  // Construct file path
  const filePath = `${CONFIG.publicDir}/${pathname}`;

  console.log(`Serving: ${filePath}`);
  return await serveFile(filePath);
}

// Main execution
async function main(): Promise<void> {
  try {
    // Start watch mode (includes initial build)
    startWatchMode();

    console.log('Place your index.html and other files to serve in the public directory');
    console.log(`🚀 Server running at http://localhost:${CONFIG.port}`);

    // Start the HTTP server
    await Deno.serve({ port: CONFIG.port }, requestHandler);
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    Deno.exit(1);
  }
}

// Start the application
if (import.meta.main) {
  main();
}