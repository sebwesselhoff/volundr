import { useCallback, useEffect, useReducer } from 'react';
import { useWebSocket } from './use-websocket';
import type {
  Team, TeamMember, TeamMessage, TeamTask, DisplayMessage, ServerMessage,
} from '@vldr/shared';
import { API_PORT } from '@vldr/shared';

interface TeamViewState {
  members: TeamMember[];
  messages: DisplayMessage[];
  tasks: TeamTask[];
  isLoading: boolean;
}

type Action =
  | { type: 'loading' }
  | { type: 'loaded'; members: TeamMember[]; messages: TeamMessage[]; tasks: TeamTask[] }
  | { type: 'member_joined'; member: TeamMember }
  | { type: 'member_updated'; data: Partial<TeamMember> & { id: string } }
  | { type: 'member_left'; member: TeamMember }
  | { type: 'message'; message: TeamMessage }
  | { type: 'system_event'; event: string; detail: string; timestamp: string; teamId: string }
  | { type: 'task_created'; task: TeamTask }
  | { type: 'task_updated'; data: Partial<TeamTask> & { id: number } };

function reducer(state: TeamViewState, action: Action): TeamViewState {
  switch (action.type) {
    case 'loading':
      return { ...state, isLoading: true };
    case 'loaded':
      return {
        members: action.members,
        messages: action.messages.map(m => ({ kind: 'chat' as const, data: m })),
        tasks: action.tasks,
        isLoading: false,
      };
    case 'member_joined':
      return { ...state, members: [...state.members, action.member] };
    case 'member_updated':
      return {
        ...state,
        members: state.members.map(m =>
          m.id === action.data.id ? { ...m, ...action.data } : m
        ),
      };
    case 'member_left':
      return {
        ...state,
        members: state.members.map(m =>
          m.id === action.member.id ? action.member : m
        ),
      };
    case 'message':
      return {
        ...state,
        messages: [...state.messages, { kind: 'chat', data: action.message }],
      };
    case 'system_event':
      return {
        ...state,
        messages: [...state.messages, {
          kind: 'system',
          event: action.event,
          detail: action.detail,
          timestamp: action.timestamp,
          teamId: action.teamId,
        }],
      };
    case 'task_created':
      return { ...state, tasks: [...state.tasks, action.task] };
    case 'task_updated':
      return {
        ...state,
        tasks: state.tasks.map(t =>
          t.id === action.data.id ? { ...t, ...action.data } : t
        ),
      };
    default:
      return state;
  }
}

const INITIAL: TeamViewState = { members: [], messages: [], tasks: [], isLoading: true };

export function useTeamData(teamId: string | null) {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const { subscribe } = useWebSocket();

  useEffect(() => {
    if (!teamId) return;
    dispatch({ type: 'loading' });

    const base = `http://localhost:${API_PORT}/api/teams/${teamId}`;
    Promise.all([
      fetch(base).then(r => r.json()),
      fetch(`${base}/messages?limit=200`).then(r => r.json()),
      fetch(`${base}/tasks`).then(r => r.json()),
    ]).then(([teamData, messages, tasks]) => {
      dispatch({
        type: 'loaded',
        members: teamData.members ?? [],
        messages: (messages as TeamMessage[]).reverse(),
        tasks,
      });
    }).catch(err => {
      console.error('[useTeamData] fetch failed:', err);
      dispatch({ type: 'loaded', members: [], messages: [], tasks: [] });
    });
  }, [teamId]);

  useEffect(() => {
    if (!teamId) return;

    const unsub = subscribe((msg: ServerMessage) => {
      switch (msg.type) {
        case 'team:member_joined':
          if (msg.data.teamId === teamId) dispatch({ type: 'member_joined', member: msg.data });
          break;
        case 'team:member_updated':
          dispatch({ type: 'member_updated', data: msg.data });
          break;
        case 'team:member_left':
          if (msg.data.teamId === teamId) dispatch({ type: 'member_left', member: msg.data });
          break;
        case 'team:message':
          if (msg.data.teamId === teamId) dispatch({ type: 'message', message: msg.data });
          break;
        case 'team:task_created':
          if (msg.data.teamId === teamId) dispatch({ type: 'task_created', task: msg.data });
          break;
        case 'team:task_updated':
          dispatch({ type: 'task_updated', data: msg.data });
          break;
        case 'team:ended':
          if (msg.data.teamId === teamId) {
            dispatch({
              type: 'system_event',
              event: 'team_ended',
              detail: 'Team ended',
              timestamp: msg.data.endedAt,
              teamId,
            });
          }
          break;
      }
    });

    return unsub;
  }, [teamId, subscribe]);

  return state;
}
