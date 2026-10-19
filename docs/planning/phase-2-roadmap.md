# Brazi Business Intelligence — Fase 2

Status: planejamento inicial, sujeito a aprovação de escopo.

## Baseline
MVP 1.0 homologado pelo proprietário após auditoria de dados. Referência de código: `be218e443ab6a651a88ddb8d337159c11ecbe6d9`; branch de preservação: `release/mvp-1.0`. Produção em `main`; desenvolvimento isolado em `develop/phase-2`.

## Objetivo
Converter histórico de pedidos, itens e clientes em inteligência comercial acionável, com métricas rastreáveis, filtros coerentes e dados auditáveis.

## Frentes propostas
1. **P0 — Governança:** baseline, critérios de aceite, integridade da sincronização, controle de alterações e regressão do MVP.
2. **P1 — Clientes:** novos e recorrentes, frequência, coortes de retenção, RFM e valor acumulado por cliente (não confundir com LTV preditivo).
3. **P1 — Produtos:** desempenho por estampa, modelagem e cor; cestas frequentes; afinidade; kits candidatos; normalização de variantes.
4. **P2 — Performance comercial:** tendências, períodos comparáveis, sazonalidade e segmentação.
5. **P2 — Marketing:** Meta Ads com investimento, atribuição explicitada, ROAS observado e limitações de conciliação.
6. **P3 — Insights:** alertas explicáveis e oportunidades comerciais fundamentadas.

## Primeira entrega sugerida
Clientes + Produtos, após diagnóstico do modelo de dados e validação das definições de métricas.

## Critérios de aceite
- Indicadores documentados com fórmula, granularidade, filtros e exclusões.
- Conciliação de amostras com dados brutos; testes de regressão preservando o MVP.
- Não alterar regras financeiras homologadas sem aprovação.
- Nenhum deploy automático da branch de desenvolvimento para produção.
- Evitar métricas de atribuição ou previsão sem base verificável.

## Próximos passos
Inventariar tabelas, endpoints e campos disponíveis; especificar KPIs e wireframes; implementar incrementos com testes; validar com dados reais; promover para produção somente após aprovação explícita.
