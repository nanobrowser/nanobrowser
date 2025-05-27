# Set Value Tool

The `set_value` tool enables AI systems to set values on interactive web page elements through the MCP host. This tool supports various element types including text inputs, select dropdowns, checkboxes, and other form elements.

## Overview

The set_value tool is designed to handle form input operations by:
1. Accepting targeting parameters to identify specific elements
2. Supporting different input methods based on element type
3. Providing flexible options for input behavior
4. Returning detailed information about the operation result

## Tool Schema

```json
{
  "name": "set_value",
  "description": "Set values on interactive elements on web pages using element index from DOM state or description-based targeting",
  "inputSchema": {
    "type": "object",
    "properties": {
      "target": {
        "description": "Target element identifier - element index (0-based) when target_type is 'index', or description text when target_type is 'description'",
        "oneOf": [
          { "type": "number", "minimum": 0 },
          { "type": "string", "minLength": 1 }
        ]
      },
      "target_type": {
        "type": "string",
        "enum": ["index", "description"],
        "default": "index",
        "description": "How to interpret the target parameter"
      },
      "value": {
        "description": "Value to set on the element - string for text inputs, boolean for checkboxes, string for select options",
        "oneOf": [
          { "type": "string" },
          { "type": "boolean" },
          { "type": "number" }
        ]
      },
      "options": {
        "type": "object",
        "properties": {
          "clear_first": {
            "type": "boolean",
            "default": true,
            "description": "Whether to clear existing content before setting value (for text inputs)"
          },
          "submit": {
            "type": "boolean",
            "default": false,
            "description": "Whether to submit the form after setting the value"
          },
          "wait_after": {
            "type": "number",
            "minimum": 0,
            "maximum": 30,
            "default": 1,
            "description": "Time to wait after setting value (seconds)"
          }
        }
      }
    },
    "required": ["target", "value"]
  }
}
```

## Usage Examples

### Basic Text Input

```json
{
  "target": 0,
  "target_type": "index",
  "value": "Hello World"
}
```

### Description-based Targeting

```json
{
  "target": "Enter your email",
  "target_type": "description", 
  "value": "user@example.com"
}
```

### Checkbox Toggle

```json
{
  "target": 2,
  "target_type": "index",
  "value": true
}
```

### Select Dropdown

```json
{
  "target": 1,
  "target_type": "index",
  "value": "Option 2"
}
```

### With Options

```json
{
  "target": 0,
  "target_type": "index",
  "value": "Test value",
  "options": {
    "clear_first": false,
    "submit": true,
    "wait_after": 2.0
  }
}
```

## Element Type Support

### Text Inputs
- **Input method**: `type`
- **Value type**: `string`
- **Options**: `clear_first` to control whether existing content is cleared

### Select Dropdowns
- **Input method**: `single-select` or `multi-select`
- **Value type**: `string` (option text) or `number` (option index)
- **Behavior**: Selects the matching option

### Checkboxes
- **Input method**: `toggle`
- **Value type**: `boolean`
- **Behavior**: Sets checked state

### Radio Buttons
- **Input method**: `select`
- **Value type**: `string` or `boolean`
- **Behavior**: Selects the radio option

### Other Input Types
- **Input method**: Various based on element type
- **Value type**: Appropriate for the specific input type

## Response Format

```json
{
  "success": true,
  "message": "Successfully set value",
  "target": 0,
  "target_type": "index",
  "element_index": 0,
  "element_type": "text-input",
  "input_method": "type",
  "actual_value": "Hello World",
  "element_info": {
    "tag_name": "input",
    "text": "",
    "placeholder": "Enter text here",
    "name": "text-input",
    "id": "text-input",
    "type": "text"
  },
  "options_used": {
    "clear_first": true,
    "submit": false,
    "wait_after": 1.0
  }
}
```

## Error Handling

The tool validates input parameters and returns appropriate error messages for:

- Missing required parameters (`target`, `value`)
- Invalid `wait_after` values (negative or > 30 seconds)
- Invalid target element indices
- Unsupported element types
- Network or communication errors

## Implementation Details

### Go MCP Host Side

The tool is implemented in `mcp-host-go/pkg/tools/set_value.go` and:
1. Validates input parameters according to the JSON schema
2. Formats the request for the Chrome extension
3. Sends RPC calls via Native Messaging
4. Returns formatted responses with operation details

### Chrome Extension Side

The handler in `chrome-extension/src/background/task/set-value-handler.ts`:
1. Locates the target element using DOM queries
2. Determines the appropriate input method based on element type
3. Performs the value setting operation
4. Returns detailed operation results

## Integration Testing

Comprehensive integration tests are available in `mcp-host-go/tests/integration/set_value_test.go` covering:

- Basic functionality with different element types
- Parameter validation
- Error handling
- Schema validation
- Different targeting methods (index vs description)

## Best Practices

1. **Use DOM State First**: Check the DOM state resource to understand available elements before using this tool
2. **Prefer Index Targeting**: Element indices are more reliable than description-based targeting
3. **Handle Errors Gracefully**: Always check the success field in responses
4. **Wait Appropriately**: Use reasonable `wait_after` values for page interactions
5. **Clear Before Setting**: Use `clear_first: true` for text inputs to avoid unexpected content

## Related Tools

- `click_element`: For clicking buttons and links
- `get_dom_extra_elements`: For discovering available interactive elements
- `scroll_page`: For bringing elements into view before interaction

## Resources

- `browser://dom/state`: Current DOM state with interactive elements
- `browser://current/state`: Complete browser state information
