"use client";

import { createContext, useContext } from "react";

export const ReaderAuxiliaryVisibility = createContext({ visible: true, overlay: false });
export function useReaderAuxiliaryVisibility() { return useContext(ReaderAuxiliaryVisibility); }
