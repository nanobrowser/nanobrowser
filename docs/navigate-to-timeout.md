# Navigate To Tool with Timeout Support

The `navigate_to` tool now supports intelligent timeout handling to provide better control over navigation operations.

## Overview

The enhanced `navigate_to` tool includes a new optional `timeout` parameter that allows users to control how long the tool waits for navigation to complete. This is particularly useful for handling slow-loading pages or ensuring predictable behavior in automated workflows.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | Yes | - | The URL to navigate to |
| `timeout` | string | No | `"auto"` | Navigation timeout strategy |

## Timeout Parameter Values

### Auto Mode (`"auto"`)
- **Default behavior** when no timeout is specified
- Uses intelligent timeout detection (30 seconds)
- Recommended for most use cases
- Provides good balance between reliability and performance

### Custom Timeout (milliseconds)
- Specify exact timeout in milliseconds as a string
- Range: `1000` to `120000` (1 second to 2 minutes)
- Example: `"5000"` for 5 seconds
- Useful for known fast/slow loading scenarios

## Usage Examples

### Basic Navigation (Auto Timeout)
```json
{
  "name": "navigate_to",
  "arguments": {
    "url": "https://example.com"
  }
}
```

### Navigation with Custom Timeout
```json
{
  "name": "navigate_to",
  "arguments": {
    "url": "https://slow-loading-site.com",
    "timeout": "15000"
  }
}
```

### Explicit Auto Timeout
```json
{
  "name": "navigate_to",
  "arguments": {
    "url": "https://example.com",
    "timeout": "auto"
  }
}
```

## Response Format

The tool response now includes additional information about the timeout strategy used:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Successfully navigated to https://example.com (strategy: auto)"
    }
  ]
}
```

Response fields:
- **success**: Boolean indicating navigation success
- **message**: Descriptive message about the navigation
- **url**: The final URL navigated to
- **strategy**: The timeout strategy used (`"auto"` or milliseconds)
- **timeoutUsed**: The actual timeout value applied in milliseconds

## Error Handling

### Invalid Timeout Values
- Timeouts below 1000ms or above 120000ms will be rejected
- Invalid format (non-numeric strings except "auto") will be rejected
- Error message: `"timeout must be between 1000 and 120000 milliseconds"`

### Navigation Timeout
- If navigation exceeds the specified timeout, the operation fails
- Error message: `"Navigation timeout after {timeout}ms"`
- The browser tab may still be in a loading state

### Invalid URL Format
- URLs are automatically prefixed with `https://` if no protocol is specified
- Invalid URLs will be rejected with descriptive error messages

## Implementation Details

### Browser Extension Side
- Enhanced `NavigateToHandler` with timeout parsing and validation
- Custom navigation promise with timeout handling
- Intelligent waiting for tab completion (URL, title, and loading status)
- Graceful cleanup of event listeners on timeout or completion

### MCP Host Side
- Updated `NavigateToTool` with timeout parameter in schema
- Validation of timeout values with appropriate error messages
- Enhanced RPC timeout handling with buffer for communication overhead

## Timeout Strategy Recommendations

### Use Auto Timeout When:
- General web browsing and navigation
- Unknown page loading characteristics
- Default automation workflows
- Maximum compatibility and reliability needed

### Use Custom Timeout When:
- Known fast-loading pages (reduce wait time)
- Known slow-loading pages (increase wait time)
- Specific performance requirements
- Integration with external timing constraints

### Typical Timeout Values:
- **Fast sites**: 3000-5000ms (3-5 seconds)
- **Regular sites**: 5000-10000ms (5-10 seconds)  
- **Slow sites**: 15000-30000ms (15-30 seconds)
- **Very slow sites**: 30000-60000ms (30-60 seconds)

## Backward Compatibility

- Existing calls without the `timeout` parameter continue to work unchanged
- Default behavior remains the same (auto timeout)
- No breaking changes to existing integrations

## Error Scenarios and Troubleshooting

### Common Issues:

1. **Timeout too short**: Increase timeout value for slow-loading pages
2. **Network issues**: Auto timeout should handle most network delays
3. **JavaScript-heavy pages**: May require longer timeouts
4. **Popup blockers**: May interfere with navigation timing

### Debugging Tips:

- Start with auto timeout for unknown sites
- Use browser developer tools to measure actual page load times
- Consider page complexity when setting custom timeouts
- Monitor browser console for JavaScript errors that might affect loading
