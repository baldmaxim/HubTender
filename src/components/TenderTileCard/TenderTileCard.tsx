/**
 * Плитка быстрого выбора тендера — единый вид на всех страницах.
 * Эталон разметки — экран выбора на «Финансовых показателях»: на телефоне
 * (isPhoneDevice — портрет и ландшафт) компактная карточка 160px без номера
 * тендера, на десктопе/планшете — 200px с номером.
 */

import React from 'react';
import { Card, Tag, Typography } from 'antd';
import { AutoFitText } from '../AutoFitText';
import { getVersionColorByTitle } from '../../utils/versionColor';
import { useIsMobile } from '../../hooks/useIsMobile';

const { Text } = Typography;

export interface TenderTileData {
  id: string;
  title: string;
  tender_number: string;
  client_name: string;
  version?: number | null;
}

interface TenderTileCardProps {
  tender: TenderTileData;
  /** Полный список тендеров страницы — нужен для градиента цвета версии. */
  allTenders: TenderTileData[];
  onClick: () => void;
  /** URL для открытия средней кнопкой мыши в новой вкладке; не передан — обработчик не вешается. */
  deepLinkUrl?: string;
  /** Десктопный padding тела карточки; по умолчанию стандартный antd. */
  desktopBodyPadding?: string;
}

export const TenderTileCard: React.FC<TenderTileCardProps> = ({
  tender,
  allTenders,
  onClick,
  deepLinkUrl,
  desktopBodyPadding,
}) => {
  const { isPhoneDevice } = useIsMobile();
  return (
    <Card
      hoverable
      size={isPhoneDevice ? 'small' : 'default'}
      styles={{ body: { padding: isPhoneDevice ? '8px 10px' : desktopBodyPadding } }}
      style={{
        width: isPhoneDevice ? 160 : 200,
        textAlign: 'center',
        cursor: 'pointer',
        borderColor: '#10b981',
        borderWidth: 1,
      }}
      onClick={onClick}
      onAuxClick={deepLinkUrl ? (e) => {
        if (e.button === 1) {
          e.preventDefault();
          window.open(deepLinkUrl, '_blank');
        }
      } : undefined}
    >
      {isPhoneDevice ? (
        <>
          {/* Телефон: номер тендера убран; версия стоит вплотную справа от наименования (по центру). */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'nowrap', gap: 6, marginBottom: 4 }}>
            <Text strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100, fontSize: 12 }}>
              {tender.title}
            </Text>
            <Tag color={getVersionColorByTitle(tender.version, tender.title, allTenders)} style={{ flexShrink: 0, margin: 0 }}>v{tender.version || 1}</Tag>
          </div>
          <AutoFitText maxFontSize={11} minFontSize={7} align="center">
            {tender.client_name}
          </AutoFitText>
        </>
      ) : (
        <>
          <div style={{ marginBottom: 8 }}>
            <Tag color="#10b981" style={{ margin: 0 }}>{tender.tender_number}</Tag>
          </div>
          <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'nowrap', gap: 4 }}>
            <Text strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
              {tender.title}
            </Text>
            <Tag color={getVersionColorByTitle(tender.version, tender.title, allTenders)} style={{ flexShrink: 0, margin: 0 }}>v{tender.version || 1}</Tag>
          </div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {tender.client_name}
          </Text>
        </>
      )}
    </Card>
  );
};
