import { describe, it, expect } from 'vitest';
import WebSocketMessageInterpreter, { MessageDeserializationError, MessageSerializationError } from '../protocol';
import type { ExecuteTaskMessage, PingMessage, TaskAcceptedMessage, ExecutionEventMessage } from '../types';
import { AgentEvent, Actors, ExecutionState, EventType } from '../../../agent/event/types';

describe('WebSocket Message Protocol', () => {
  describe('Message Serialization', () => {
    it('serializes TaskAcceptedMessage correctly', () => {
      const message: TaskAcceptedMessage = {
        type: 'task_accepted',
        taskId: 'task-123',
        timestamp: 1234567890,
      };

      const serialized = WebSocketMessageInterpreter.send(message);
      const parsed = JSON.parse(serialized);

      expect(parsed.type).toBe('task_accepted');
      expect(parsed.taskId).toBe('task-123');
      expect(parsed.timestamp).toBe(1234567890);
    });

    it('serializes TaskRejectedMessage correctly', () => {
      const message = WebSocketMessageInterpreter.createTaskRejected('task-456', 'Already executing a task');

      const serialized = WebSocketMessageInterpreter.send(message);
      const parsed = JSON.parse(serialized);

      expect(parsed.type).toBe('task_rejected');
      expect(parsed.taskId).toBe('task-456');
      expect(parsed.reason).toBe('Already executing a task');
      expect(typeof parsed.timestamp).toBe('number');
    });

    it('serializes ExecutionEventMessage with AgentEvent correctly', () => {
      const agentEvent = new AgentEvent(
        Actors.NAVIGATOR,
        ExecutionState.TASK_START,
        {
          taskId: 'task-789',
          step: 1,
          maxSteps: 10,
          details: 'Starting task execution',
        },
        1234567890,
      );

      const message: ExecutionEventMessage = {
        type: 'execution_event',
        taskId: 'task-789',
        event: agentEvent,
        timestamp: 1234567890,
      };

      const serialized = WebSocketMessageInterpreter.send(message);
      const parsed = JSON.parse(serialized);

      expect(parsed.type).toBe('execution_event');
      expect(parsed.taskId).toBe('task-789');
      expect(parsed.event.actor).toBe(Actors.NAVIGATOR);
      expect(parsed.event.state).toBe(ExecutionState.TASK_START);
      expect(parsed.event.data.taskId).toBe('task-789');
      expect(parsed.event.data.step).toBe(1);
      expect(parsed.event.data.maxSteps).toBe(10);
      expect(parsed.event.type).toBe(EventType.EXECUTION);
    });

    it('serializes PongMessage correctly', () => {
      const message = WebSocketMessageInterpreter.createPong();

      const serialized = WebSocketMessageInterpreter.send(message);
      const parsed = JSON.parse(serialized);

      expect(parsed.type).toBe('pong');
      expect(typeof parsed.timestamp).toBe('number');
    });

    it('throws MessageSerializationError for circular references', () => {
      const circularMessage: any = {
        type: 'task_accepted',
        taskId: 'test',
        timestamp: Date.now(),
      };
      circularMessage.circular = circularMessage;

      expect(() => {
        WebSocketMessageInterpreter.send(circularMessage);
      }).toThrow(MessageSerializationError);
    });
  });

  describe('Message Deserialization', () => {
    it('deserializes ExecuteTaskMessage correctly', () => {
      const json = JSON.stringify({
        type: 'execute_task',
        taskId: 'task-123',
        prompt: 'Navigate to example.com',
        metadata: {
          priority: 1,
          timeout: 30000,
        },
      });

      const message = WebSocketMessageInterpreter.receive(json) as ExecuteTaskMessage;

      expect(message.type).toBe('execute_task');
      expect(message.taskId).toBe('task-123');
      expect(message.prompt).toBe('Navigate to example.com');
      expect(message.metadata?.priority).toBe(1);
      expect(message.metadata?.timeout).toBe(30000);
    });

    it('deserializes ExecuteTaskMessage without metadata', () => {
      const json = JSON.stringify({
        type: 'execute_task',
        taskId: 'task-456',
        prompt: 'Search for something',
      });

      const message = WebSocketMessageInterpreter.receive(json) as ExecuteTaskMessage;

      expect(message.type).toBe('execute_task');
      expect(message.taskId).toBe('task-456');
      expect(message.prompt).toBe('Search for something');
      expect(message.metadata).toBeUndefined();
    });

    it('deserializes PingMessage correctly', () => {
      const json = JSON.stringify({
        type: 'ping',
        timestamp: 1234567890,
      });

      const message = WebSocketMessageInterpreter.receive(json) as PingMessage;

      expect(message.type).toBe('ping');
      expect(message.timestamp).toBe(1234567890);
    });

    it('throws MessageDeserializationError for invalid JSON', () => {
      const invalidJson = '{ invalid json }';

      expect(() => {
        WebSocketMessageInterpreter.receive(invalidJson);
      }).toThrow(MessageDeserializationError);
    });

    it('throws MessageDeserializationError for missing type field', () => {
      const json = JSON.stringify({
        taskId: 'task-123',
        prompt: 'test',
      });

      expect(() => {
        WebSocketMessageInterpreter.receive(json);
      }).toThrow(MessageDeserializationError);
      expect(() => {
        WebSocketMessageInterpreter.receive(json);
      }).toThrow('Message must be an object with a type field');
    });

    it('throws MessageDeserializationError for unknown message type', () => {
      const json = JSON.stringify({
        type: 'unknown_type',
        data: 'test',
      });

      expect(() => {
        WebSocketMessageInterpreter.receive(json);
      }).toThrow(MessageDeserializationError);
      expect(() => {
        WebSocketMessageInterpreter.receive(json);
      }).toThrow('Unknown message type');
    });

    it('throws MessageDeserializationError for ExecuteTaskMessage with missing taskId', () => {
      const json = JSON.stringify({
        type: 'execute_task',
        prompt: 'test',
      });

      expect(() => {
        WebSocketMessageInterpreter.receive(json);
      }).toThrow(MessageDeserializationError);
      expect(() => {
        WebSocketMessageInterpreter.receive(json);
      }).toThrow('ExecuteTaskMessage must have a non-empty taskId string');
    });

    it('throws MessageDeserializationError for ExecuteTaskMessage with empty taskId', () => {
      const json = JSON.stringify({
        type: 'execute_task',
        taskId: '',
        prompt: 'test',
      });

      expect(() => {
        WebSocketMessageInterpreter.receive(json);
      }).toThrow(MessageDeserializationError);
    });

    it('throws MessageDeserializationError for ExecuteTaskMessage with missing prompt', () => {
      const json = JSON.stringify({
        type: 'execute_task',
        taskId: 'task-123',
      });

      expect(() => {
        WebSocketMessageInterpreter.receive(json);
      }).toThrow(MessageDeserializationError);
      expect(() => {
        WebSocketMessageInterpreter.receive(json);
      }).toThrow('ExecuteTaskMessage must have a non-empty prompt string');
    });

    it('throws MessageDeserializationError for PingMessage with invalid timestamp', () => {
      const json = JSON.stringify({
        type: 'ping',
        timestamp: 'not-a-number',
      });

      expect(() => {
        WebSocketMessageInterpreter.receive(json);
      }).toThrow(MessageDeserializationError);
      expect(() => {
        WebSocketMessageInterpreter.receive(json);
      }).toThrow('PingMessage must have a numeric timestamp');
    });
  });

  describe('Message Roundtrip', () => {
    it('preserves TaskAcceptedMessage through serialization and deserialization', () => {
      const original = WebSocketMessageInterpreter.createTaskAccepted('task-roundtrip');

      // Can't deserialize outgoing messages directly, but we can verify serialization works
      const serialized = WebSocketMessageInterpreter.send(original);
      const parsed = JSON.parse(serialized);

      expect(parsed.type).toBe(original.type);
      expect(parsed.taskId).toBe(original.taskId);
    });

    it('preserves ExecutionEventMessage through serialization', () => {
      const agentEvent = new AgentEvent(Actors.SYSTEM, ExecutionState.ACT_OK, {
        taskId: 'task-roundtrip',
        step: 5,
        maxSteps: 10,
        details: 'Action completed',
      });

      const original = WebSocketMessageInterpreter.createExecutionEvent('task-roundtrip', agentEvent);
      const serialized = WebSocketMessageInterpreter.send(original);
      const parsed = JSON.parse(serialized);

      expect(parsed.type).toBe(original.type);
      expect(parsed.taskId).toBe(original.taskId);
      expect(parsed.event.actor).toBe(agentEvent.actor);
      expect(parsed.event.state).toBe(agentEvent.state);
      expect(parsed.event.data.taskId).toBe(agentEvent.data.taskId);
      expect(parsed.event.data.step).toBe(agentEvent.data.step);
    });
  });

  describe('Helper Methods', () => {
    it('creates TaskAccepted with correct structure', () => {
      const message = WebSocketMessageInterpreter.createTaskAccepted('helper-test');

      expect(message.type).toBe('task_accepted');
      expect(message.taskId).toBe('helper-test');
      expect(typeof message.timestamp).toBe('number');
    });

    it('creates TaskRejected with correct structure', () => {
      const message = WebSocketMessageInterpreter.createTaskRejected('helper-test', 'Test reason');

      expect(message.type).toBe('task_rejected');
      expect(message.taskId).toBe('helper-test');
      expect(message.reason).toBe('Test reason');
      expect(typeof message.timestamp).toBe('number');
    });

    it('creates ExecutionEvent with correct structure', () => {
      const agentEvent = new AgentEvent(Actors.PLANNER, ExecutionState.STEP_START, {
        taskId: 'helper-test',
        step: 1,
        maxSteps: 5,
        details: 'Planning step',
      });

      const message = WebSocketMessageInterpreter.createExecutionEvent('helper-test', agentEvent);

      expect(message.type).toBe('execution_event');
      expect(message.taskId).toBe('helper-test');
      expect(message.event).toBe(agentEvent);
      expect(typeof message.timestamp).toBe('number');
    });

    it('creates Pong with correct structure', () => {
      const message = WebSocketMessageInterpreter.createPong();

      expect(message.type).toBe('pong');
      expect(typeof message.timestamp).toBe('number');
    });
  });
});
