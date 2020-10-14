import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import {
  isFulfilledAction,
  isPendingAction,
  isRejectedAction,
} from "../utils/redux";
import { APIFactory } from "../api/token";
import { SerializableToken } from "../api/token/Token";
import { RootState } from "../app/rootReducer";
import { notify } from "../components/notify";

export interface GlobalState {
  loading: number;
  error: string | null;
  availableTokens: Array<SerializableToken>;
}

const initialState: GlobalState = {
  loading: 0,
  error: null,
  availableTokens: [],
};

export const GLOBAL_SLICE_NAME = "global";

/**
 * Fetch all available tokens.
 */
export const getAvailableTokens = createAsyncThunk(
  GLOBAL_SLICE_NAME + "/getAvailableTokens",
  async (arg, thunkAPI): Promise<Array<SerializableToken>> => {
    const {
      wallet: { cluster },
    } = thunkAPI.getState() as RootState;

    const tokenAPI = APIFactory(cluster);
    const tokens = await tokenAPI.getTokens();
    return tokens.map((token) => token.serialize());
  }
);

const globalSlice = createSlice({
  name: GLOBAL_SLICE_NAME,
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder.addCase(getAvailableTokens.fulfilled, (state, action) => ({
      ...state,
      availableTokens: action.payload,
    }));
    builder.addMatcher(isPendingAction, (state) => ({
      ...state,
      loading: state.loading + 1,
    }));
    builder.addMatcher(isRejectedAction, (state, action) => {
      notify(action.error.message);
      return {
        ...state,
        loading: state.loading - 1,
        error: action.error.message,
      };
    });
    builder.addMatcher(isFulfilledAction, (state) => ({
      ...state,
      loading: state.loading - 1,
    }));
  },
});

export default globalSlice.reducer;
