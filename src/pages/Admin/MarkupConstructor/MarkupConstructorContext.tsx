import React, { createContext, useContext } from 'react';
import { FormInstance } from 'antd';
import { useMarkupTactics, useMarkupParameters, useMarkupSequences, usePricingDistribution } from './hooks';

interface MarkupConstructorContextType {
  // Tactics hook
  tactics: ReturnType<typeof useMarkupTactics>;
  // Parameters hook
  parameters: ReturnType<typeof useMarkupParameters>;
  // Sequences hook
  sequences: ReturnType<typeof useMarkupSequences>;
  // Pricing hook
  pricing: ReturnType<typeof usePricingDistribution>;
  // Form instance for markup values
  form: FormInstance;
}

const MarkupConstructorContext = createContext<MarkupConstructorContextType | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export const useMarkupConstructorContext = () => {
  const context = useContext(MarkupConstructorContext);
  if (!context) {
    throw new Error('useMarkupConstructorContext must be used within MarkupConstructorProvider');
  }
  return context;
};

interface MarkupConstructorProviderProps {
  children: React.ReactNode;
  value: MarkupConstructorContextType;
}

export const MarkupConstructorProvider: React.FC<MarkupConstructorProviderProps> = ({ children, value }) => {
  return (
    <MarkupConstructorContext.Provider value={value}>
      {children}
    </MarkupConstructorContext.Provider>
  );
};
