import { assignSeat } from './seat-layout';

// ---------------------------------------------------------------------------
// Phase
// ---------------------------------------------------------------------------

export type ScenePhase = 'empty' | 'igniting' | 'active' | 'disbanding' | 'embers';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface AgentState {
  id: string;
  type: string;       // 'volundr', 'developer', 'architect', etc.
  name: string;       // display name
  seatIndex: number;
  status: 'seated' | 'entering' | 'leaving' | 'working' | 'speaking';
  cardId?: string;
}

export interface BubbleState {
  agentId: string;
  text: string;
  fromAgent: string;
  timestamp: number;  // Date.now() when created
}

export interface SceneState {
  phase: ScenePhase;
  agents: AgentState[];
  bubbles: BubbleState[];
  summaryText: string | null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type SceneAction =
  | { type: 'TEAM_CREATED' }
  | { type: 'IGNITION_COMPLETE' }
  | { type: 'MEMBER_JOINED'; agent: { id: string; type: string; name: string } }
  | { type: 'MEMBER_LEFT'; agentId: string }
  | { type: 'MEMBER_REMOVED'; agentId: string }
  | { type: 'MESSAGE'; agentId: string; text: string; fromAgent: string }
  | { type: 'BUBBLE_EXPIRED'; agentId: string }
  | { type: 'AGENT_SEATED'; agentId: string }
  | { type: 'AGENT_WORKING'; agentId: string; cardId: string }
  | { type: 'AGENT_IDLE'; agentId: string }
  | { type: 'TEAM_ENDED'; summary?: string }
  | { type: 'DISBANDMENT_COMPLETE' }
  | { type: 'EMBERS_EXPIRED' }
  | { type: 'RESET' };

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialState: SceneState = {
  phase: 'empty',
  agents: [],
  bubbles: [],
  summaryText: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function updateAgent(
  agents: AgentState[],
  agentId: string,
  patch: Partial<AgentState>,
): AgentState[] {
  return agents.map((a) => (a.id === agentId ? { ...a, ...patch } : a));
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function sceneReducer(state: SceneState, action: SceneAction): SceneState {
  switch (action.type) {
    // empty → igniting
    case 'TEAM_CREATED': {
      if (state.phase !== 'empty') return state;
      return { ...state, phase: 'igniting' };
    }

    // igniting → active  (called after 1.5s timer by the consumer)
    case 'IGNITION_COMPLETE': {
      if (state.phase !== 'igniting') return state;
      return { ...state, phase: 'active' };
    }

    // Add an agent with an auto-assigned seat
    case 'MEMBER_JOINED': {
      const { id, type, name } = action.agent;
      // Avoid duplicates
      if (state.agents.some((a) => a.id === id)) return state;
      const occupiedSeats = new Set(state.agents.map((a) => a.seatIndex));
      const seatIndex = assignSeat(id, occupiedSeats, type);
      const newAgent: AgentState = {
        id,
        type,
        name,
        seatIndex,
        status: 'entering',
      };
      return { ...state, agents: [...state.agents, newAgent] };
    }

    // Transition entering agent to seated (after fade-in delay)
    case 'AGENT_SEATED': {
      const agent = state.agents.find(a => a.id === action.agentId);
      if (!agent || agent.status !== 'entering') return state;
      return { ...state, agents: updateAgent(state.agents, action.agentId, { status: 'seated' }) };
    }

    // Mark agent as leaving (animation plays before MEMBER_REMOVED)
    case 'MEMBER_LEFT': {
      return {
        ...state,
        agents: updateAgent(state.agents, action.agentId, { status: 'leaving' }),
      };
    }

    // Actually remove the agent (after leave animation completes)
    case 'MEMBER_REMOVED': {
      return {
        ...state,
        agents: state.agents.filter((a) => a.id !== action.agentId),
        bubbles: state.bubbles.filter((b) => b.agentId !== action.agentId),
      };
    }

    // Add a speech bubble and set the agent to speaking
    case 'MESSAGE': {
      const { agentId, text, fromAgent } = action;
      const newBubble: BubbleState = {
        agentId,
        text,
        fromAgent,
        timestamp: Date.now(),
      };
      // Replace any existing bubble for this agent so only one shows at a time
      const bubbles = [
        ...state.bubbles.filter((b) => b.agentId !== agentId),
        newBubble,
      ];
      return {
        ...state,
        agents: updateAgent(state.agents, agentId, { status: 'speaking' }),
        bubbles,
      };
    }

    // Remove bubble; revert agent to seated or working
    case 'BUBBLE_EXPIRED': {
      const agent = state.agents.find((a) => a.id === action.agentId);
      const nextStatus = agent?.cardId ? 'working' : 'seated';
      return {
        ...state,
        agents: updateAgent(state.agents, action.agentId, { status: nextStatus }),
        bubbles: state.bubbles.filter((b) => b.agentId !== action.agentId),
      };
    }

    // Set agent to working on a card
    case 'AGENT_WORKING': {
      return {
        ...state,
        agents: updateAgent(state.agents, action.agentId, {
          status: 'working',
          cardId: action.cardId,
        }),
      };
    }

    // Set agent back to idle / seated
    case 'AGENT_IDLE': {
      return {
        ...state,
        agents: updateAgent(state.agents, action.agentId, {
          status: 'seated',
          cardId: undefined,
        }),
      };
    }

    // active → disbanding
    case 'TEAM_ENDED': {
      if (state.phase !== 'active') return state;
      return {
        ...state,
        phase: 'disbanding',
        summaryText: action.summary ?? null,
      };
    }

    // disbanding → embers
    case 'DISBANDMENT_COMPLETE': {
      if (state.phase !== 'disbanding') return state;
      return { ...state, phase: 'embers' };
    }

    // embers → empty, clear everything
    case 'EMBERS_EXPIRED': {
      if (state.phase !== 'embers') return state;
      return initialState;
    }

    // Hard reset to initial state
    case 'RESET': {
      return initialState;
    }

    default: {
      return state;
    }
  }
}
