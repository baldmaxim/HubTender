import React, { useCallback } from 'react';
import { Button } from 'antd';
import { AuditOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useWorkspaceTabActions } from '../../../contexts/WorkspaceTabsContext';

interface AutopriceReviewButtonProps {
  tenderId: string;
}

/** Переход на страницу «Подтверждение авторасценки» сразу на нужный тендер. */
export const AutopriceReviewButton: React.FC<AutopriceReviewButtonProps> = ({ tenderId }) => {
  const navigate = useNavigate();
  const { openPageTab } = useWorkspaceTabActions();

  const handleClick = useCallback(() => {
    const url = `/autoprice-review?tenderId=${encodeURIComponent(tenderId)}`;
    openPageTab(url);
    navigate(url);
  }, [tenderId, openPageTab, navigate]);

  return (
    <Button icon={<AuditOutlined />} onClick={handleClick} size="small">
      Подтверждение авторасценки
    </Button>
  );
};
