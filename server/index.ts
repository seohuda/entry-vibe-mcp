#!/usr/bin/env node
/**
 * EntryVibe MCP server — stdio transport.
 * Stateless tools: list_categories, search_blocks, get_block_schema,
 * validate_project, compile_project.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.ts';

async function main() {
  const server = new McpServer({
    name: 'entry-vibe-mcp',
    version: '0.1.0',
  });

  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('entry-vibe-mcp failed to start:', err);
  process.exit(1);
});
