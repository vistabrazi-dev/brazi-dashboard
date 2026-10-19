# E1 — Runbook de viabilidade e preparação documental (G1)

Data: 19/10/2026. Branch: `develop/phase-2`.
Decisão recebida: opção A — Supabase separado, Render separado e snapshot comercial normalizado mínimo.
Estado: **procedimento proposto; capacidade das contas e acesso à origem não verificados**.

Este documento executa apenas a preparação documental do G1. Não autoriza provisionamento, exportação, importação, criação de credenciais/políticas, deploy ou início de G2/G3. As operações abaixo estão descritas para execução futura após as autorizações correspondentes. Não há conexão a banco real nesta etapa.

Referência: [plano aprovado com condições](phase-2-e1-staging-homologation-plan.md).

## 1. Responsabilidades e portões

- Responsável Brazi: conferir painéis, aprovar uso dos dados, orçamento, retenção e revisores.
- Operador de origem: pessoa já autorizada a ler os dados; confirmar identidade da origem e método de exportação sem executar aplicação/migração nela.
- Operador de staging: validar projeto de destino, preparar importação e conferir integridade. Preferir revisão por segunda pessoa antes de qualquer operação gravável.
- Revisor funcional: aprovar reconciliação e checklist de homologação com evidências privadas.

**G1 só fica confirmado** após retorno das verificações de conta, estimativa de volume e decisão sobre a credencial de exportação. Neste momento foi concluída a preparação documental, não a comprovação operacional de viabilidade. Não interpretar disponibilidade de um segredo no Codex como autorização para utilizá-lo.

## 2. Inventário de recursos futuros — não criar agora

| Recurso | Configuração proposta | Condição |
| --- | --- | --- |
| Supabase staging | Projeto novo e exclusivo, região compatível com Render; Postgres padrão do projeto; schema `brazi_e1_staging` | Vaga Free e capacidade suficientes; jamais usar outro schema do projeto de produção como substituto |
| Render staging | Serviço web exclusivo `brazi-dashboard-e1-staging`, Node 24, plano Free, uma instância, sem disco | Horas e demais franquias livres sem risco ao MVP; não aplicar o Blueprint atual sobre o serviço existente |
| Código | Repositório atual, branch `develop/phase-2`, SHA E1 aprovado explicitamente | Auto deploy desligado; registrar SHA antes de executar; não alterar main/release |
| Banco/credenciais | Session Pooler do novo projeto, TLS com validação, usuário independente | Credencial de produção nunca cadastrada no Render de staging |
| Autenticação | Mesmo mecanismo atual, login/hash exclusivos, sessões novas | Sem importar sessões, tentativas ou hashes de produção |
| Artefatos | Pacote de snapshot e manifesto em área privada criptografada, acesso nominal | Nenhum dado real em Git, logs, chat, pasta pública ou artefatos públicos de CI |
| Operação | Janela, limite de horas, responsáveis e data de remoção | Sem cron/keep-alive e sem token ou sincronização INK |

Configurações a revisar em G2/G3, sem cadastrar valores agora:

| Nome | Valor/origem pretendida |
| --- | --- |
| `NODE_ENV` / `NODE_VERSION` | `production` / `24` conforme configuração existente |
| `PORT` | Fornecida pelo Render |
| `DATABASE_URL` | Exclusivamente Session Pooler do projeto staging; segredo no serviço, não em arquivo versionado |
| `DATABASE_SCHEMA` | `brazi_e1_staging`, definido explicitamente |
| `DATABASE_POOL_MAX` | Começar com `1`; aumentar para `2` apenas se necessário e dentro do orçamento de conexões |
| `DATABASE_CA_CERT` | Apenas CA oficial, se exigida para manter validação TLS; não desabilitar verificação |
| `AUTH_ENABLED` / `AUTH_USERNAME` / `AUTH_PASSWORD_HASH` | Autenticação ligada, identidade e hash próprios de staging |
| `APP_ORIGIN` / `RENDER_EXTERNAL_URL` | Origem HTTPS exclusiva, sem domínio/cookie compartilhado com produção; variável Render conforme comportamento atual |
| `BUSINESS_TIMEZONE` / `DISPLAY_CURRENCY` | Configuração homologada do MVP; preservar ausência de moeda explícita se assim estiver configurado |
| `RESERVA_INK_TOKEN` | **Ausente**, inclusive de grupos herdados e ambientes de build/start |

Não adicionar variáveis imaginárias de bloqueio: a versão atual não tem modo staging/skip-migrations. O startup precisa de direitos de migração no destino isolado, além das escritas de autenticação. Separar migrador/runtime exigiria trabalho técnico futuro e autorização própria; não está implementado por este runbook.

## 3. Verificações nos painéis — somente inspeção pelo responsável

Não enviar capturas contendo segredos. Retornar apenas situação, números de quota, região e identificadores não secretos necessários à comparação privada. Os valores de referência a seguir não foram confirmados online nem nos painéis nesta etapa; prevalecem os limites vigentes da conta.

### 3.1. Render

- [ ] Em workspace/billing/usage, confirmar franquia vigente de horas Free e saldo do mês, consumo de todos os serviços e data de renovação. Referência de planejamento: 750 horas por workspace/mês.
- [ ] Identificar se produção divide essa franquia. Reservar consumo esperado de produção e margem antes de calcular a janela de staging. Um serviço continuamente ativo pode usar 720–744 horas/mês; não assumir espaço para um segundo serviço.
- [ ] Confirmar limites de build, banda, serviços e recursos disponíveis; verificar se há bloqueio de conta, cartão obrigatório, saldo pago ou upgrade automático.
- [ ] Confirmar seleção possível de plano Free e região. Não selecionar plano pago para contornar limite sem nova autorização.
- [ ] Inspecionar configuração do serviço de produção sem alterá-la: branch/domínio, auto deploy, Blueprint vinculado e grupos de ambiente. Staging não pode reutilizar esse serviço ou grupos contendo segredos.
- [ ] Confirmar comportamento vigente de suspensão por inatividade (referência: cerca de 15 minutos), cold start e procedimento disponível para suspender/remover o serviço no encerramento.
- [ ] Definir limite de horas da janela e responsável pelo acompanhamento. Se não houver mecanismo de alerta suficiente, acompanhar manualmente; não pressupor que há bloqueio automático de gastos.

### 3.2. Supabase

- [ ] Em organizações/projetos/billing, verificar vagas Free conforme regra vigente da conta (referência: dois projetos gratuitos ativos, sujeita às regras aplicáveis). Não pausar/excluir produção para liberar vaga.
- [ ] Confirmar que novo projeto Free pode ser criado sem upgrade, e escolher região próxima ao serviço web dentro das opções gratuitas.
- [ ] Conferir tamanho permitido do banco, uso por tabelas/índices, armazenamento e egress. Referências de planejamento: banco de 500 MB e egress da ordem de 5 GB/mês; distinguir cada franquia vigente no painel.
- [ ] Obter tamanho estimado do snapshot normalizado e do destino com índices, via relatório já existente ou verificação futura separadamente autorizada. G1 não consulta a origem para medir tamanho. JSON exportado comprimido não estima sozinho o espaço do banco.
- [ ] Proposta conservadora: carga + índices devem caber em até 70% da capacidade disponível; reservar margem para autenticação e operações. Caso contrário, reduzir escopo explicitamente ou rever orçamento — não descartar registros silenciosamente.
- [ ] Conferir conexões diretas e clientes do pooler permitidos, host/porta do **Session Pooler**, suporte IPv4 e TLS; utilizar usuário exato compatível com o papel escolhido. Não deduzir endereço ou credenciais pelo exemplo de outro projeto.
- [ ] Confirmar pausa por inatividade (referência: aproximadamente 7 dias), condições de retomada e disponibilidade real de backups/restauração no Free. Não presumir PITR, SLA ou restauração automática.
- [ ] Verificar separação de acesso da equipe e exposição via Data API. Schema staging não deve ser exposto à API pública; RLS/revogações permanecem como no código. Não usar chaves anon/service_role no frontend.

### 3.3. Registro obrigatório da decisão de capacidade

Preencher privadamente: data; plano/região; vagas; saldo de horas Render; reserva para produção; orçamento máximo da janela; estimativa de banco/índices; egress previsto de exportação/importação; conexões disponíveis; responsável; prazo de encerramento; fonte das informações.

Custo incremental estimado: **US$ 0 somente se todas as condições Free forem confirmadas**. Preparação humana e eventuais adaptações não estão incluídas. Se houver cobrança, falta de vaga ou risco de esgotar quota compartilhada, parar e apresentar preço oficial/período para nova aprovação; não provisionar nem alterar produção.

Referências para o responsável: [Render Free](https://render.com/docs/free), [Render preços](https://render.com/pricing), [Supabase preços](https://supabase.com/pricing), [conexões](https://supabase.com/docs/guides/database/connecting-to-postgres), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## 4. Dependência de acesso à origem e alternativas

As migrações atuais habilitam RLS sem criar política SELECT para leitor externo. Um novo papel com GRANT SELECT pode enxergar zero registros. Não usar contagem zero como evidência de ausência de vendas.

Ordem de preferência para decisão, sem executar nenhuma alternativa em G1:

1. **Leitor independente já existente e autorizado**, com USAGE no schema e SELECT nas tabelas necessárias, políticas RLS válidas e sem direitos de escrita/DDL/propriedade. Confirmar também privilégios herdados. Não criar credencial, conceder acesso ou mudar política implicitamente.
2. **Exportação pelo operador já autorizado**, com conexão existente mantida somente no ambiente seguro do operador, em transação READ ONLY. Pode operar sob papel mais privilegiado; é uma exceção explícita ao mínimo privilégio, mitigada por revisão, SQL restrito e barreira transacional. A credencial nunca vai para staging/Codex/Git. Escolher somente com aprovação da exceção.
3. **Snapshot normalizado previamente aprovado**, se já existir, com manifesto, consistência, procedência e corte comprovados. Sem essas evidências, não é referência de homologação real.
4. Se nenhuma opção for permitida, **bloquear dados reais** e usar fixtures sintéticas apenas para ensaio. Homologação funcional real continua pendente.

Somente após avaliar essas alternativas considerar pedido específico de novo papel/política SELECT em produção. Isso altera segurança/credenciais da origem e exige autorização independente, revisão RLS, escopo/tabelas, prazo e revogação. Não conceder owner, superuser ou BYPASSRLS para contornar o problema. Nenhum desses ajustes faz parte de G1.

## 5. Contrato do snapshot autorizado

A unidade é o conjunto comercial normalizado completo autorizado no mesmo corte, não um dump de banco nem uma seleção apenas de pedidos pagos. Filtrar somente vendas confirmadas removeria evidências de conciliação, reembolso e cobertura. Se o conjunto não couber no Free, negociar escopo e limitações antes; uma amostra não homologa ranking global.

Allowlist baseada em `src/domain/models.ts` e na migração inicial:

| Tabela/colunas | Conteúdo permitido |
| --- | --- |
| `orders(id, day, data, seen)` | `data`: `id`, `day`, `payment`, `status`, `exchange`, `missing` quando presente, `total`, `shipping`, `freightDifference`, `promotion`, `paymentDiscount`, `items`, `issues` |
| Itens dentro de `orders.data` | `sku`, `sourceProductId`/`sourceVariantId` quando presentes, `quantity`, `free`, `refunded`, `unit`, `total` |
| `products(id, data)` | `data`: `id`, `name`, `variants`; variantes somente `id`, `sku` |
| `refunds(order_id, data)` | `data`: `orderId`, `events`, `issues`; eventos somente `id`, `status`, `partial`, `total` |
| `runs` | Somente linhas referenciadas por `orders.seen`, última execução bem-sucedida e última execução do corte; colunas `id`, `status`, `stage`, `page`, `pages`, `processed`, `started_at`, `finished_at`, `heartbeat`; `error` sempre substituído por NULL |
| `meta` | Somente linha `key='timezone'`, com `key`, `value` |

Manter nomes e identificadores técnicos apenas porque participam da investigação e associação. Dados continuam confidenciais; não considerá-los automaticamente anônimos. Em `issues`, permitir apenas códigos comerciais conhecidos pelo domínio; conteúdo desconhecido/livre bloqueia revisão, sem publicar valor. Campos JSON inesperados exigem decisão, não cópia automática.

Excluir: tabelas de autenticação, histórico de migração de origem, schemas Supabase internos, compradores, documentos, contatos, endereços, payloads brutos, comprovantes, logs e textos livres de erro. Não enriquecer catálogo nem buscar dados na API INK.

Preservar tipos, inteiros monetários, nulls, zeros, ordem dos arrays e ausência de opcionais. Não transformar `missing`, status, quantidades ou histórico de reembolso. Não arredondar, recalcular valores ou deduplicar itens durante transporte. Usar transporte que preserve BIGINT e números sem conversão com perda de precisão; JSON.parse/stringify genérico com números fora do intervalo seguro é motivo para bloquear, não truncar.

Relacionamentos são lógicos, sem FKs no schema atual: `orders.seen → runs.id`, `refunds.order_id → orders.id`, IDs de `data` iguais às chaves externas das tabelas, itens associados ao catálogo pelas regras existentes. Ausência de produto/variante e reembolso órfão podem ser inconsistências já existentes: registrar e preservar; não inventar vínculos ou excluir para fazer a carga passar.

## 6. Procedimento futuro de exportação — origem estritamente somente leitura

**Não executar agora.** Não há exportador PostgreSQL mínimo pronto validado neste runbook; sua preparação/ensaio sintético pertence ao portão posterior autorizado. Não utilizar `Store.open()`, `npm start`, CLI de migração, sincronização ou importador SQLite na origem: esses caminhos podem executar DDL/escritas.

1. Validar autorização, papel/método escolhido, espaço e janela. Identificar origem por referência de projeto e endpoint no painel e validar os identificadores não secretos privadamente. O nome `postgres` de banco/usuário não identifica projeto.
2. Usar ferramenta de exportação exclusivamente de leitura e revisão do SQL completo. Conexão TLS validada, uma sessão Session Pooler, sem URL/senha na linha de comando, histórico, log ou pacote. Segredos apenas em armazenamento seguro, sem shell tracing; não usar o ambiente do servidor de staging para a extração.
3. Iniciar **uma única transação `REPEATABLE READ READ ONLY`** antes de qualquer SELECT comercial. Confirmar `transaction_read_only=on`; configurar timeout de consultas e sessão ociosa compatível com o volume e a janela. Se houver erro/timeout, abortar o pacote inteiro e recomeçar com novo corte autorizado; nunca juntar arquivos de transações diferentes.
4. Dentro da mesma transação, ler última execução, sucesso e referência de versão. Se a execução mais recente estiver ativa/interrompida ou se não houver sucesso de origem comprovado, interromper para decisão: não parar/reiniciar sincronização de produção para facilitar exportação. Escolher nova janela autorizada. Não buscar locks de escrita nem advisory locks de migração/sync.
5. Ler as cinco tabelas conforme allowlist; campos qualificados pelo schema de origem aprovado e nomes de tabelas fixos. Projetar explicitamente JSON/colunas, sem SELECT * nem dump geral. Qualquer paginação precisa permanecer na mesma conexão/transação, com ordenação estável por chave; nunca abrir uma transação por página.
6. No mesmo snapshot, gerar manifesto e controles: contagens por tabela/status/classificação, pedidos/itens/unidades, intervalo de dias, totais financeiros inteiros, descontos/frete/reembolsos, cobertura, duplicidades e integridade lógica. Para agregados de domínio, usar funções puras no material exportado, sem abrir Store na origem; registrar versão do cálculo.
7. Capturar campos financeiros nulos/inválidos e anomalias como distribuição de controle, sem corrigir. Hash de integridade dos arquivos e versão do formato vão no manifesto privado. Fixar timezone/moeda de comparação e mapping de execuções; registrar origem/corte sem strings de conexão.
8. Encerrar com COMMIT somente da transação READ ONLY. Fechar conexão; gerar pacote criptografado com transferência privada, checksums e revisão da allowlist. Nenhum material de origem deve ir ao Render como segredo ou arquivo de código.

Uma transação de leitura longa também pode consumir recursos e reter versões PostgreSQL. Definir timeout/janela e interromper diante de impacto; não executar benchmark na origem. Não fazer testes de INSERT/DDL nela nem para demonstrar rejeição.

## 7. Procedimento futuro de importação — somente destino isolado

**Não executar agora.** Aplicação parada e sem tráfego até o aceite da carga.

1. Confrontar a identidade do destino no painel com a ficha aprovada: referência de projeto diferente da origem, endpoint do pooler correspondente, schema `brazi_e1_staging`, papel exclusivo e nenhum vínculo com produção. Duas pessoas revisam. Se qualquer item for desconhecido, parar antes de abrir conexão gravável.
2. Usar ambiente de operação separado do exportador; não manter credencial de origem em variável padrão `DATABASE_URL`. Antes de migração, uma ferramenta de preflight não migratória deve comparar destino com allowlist privada e denylist de produção. O código atual não implementa esse guard; ensaiá-lo em ambiente sintético no portão autorizado. Não usar `Store.open()` como teste de identidade.
3. Aplicar exclusivamente migrações do SHA aprovado ao destino novo. Não importar `schema_migrations` da origem, não restaurar DDL/roles/grants de dump. Confirmar tabelas/RLS/revogações esperadas. Credencial de startup atual terá privilégios de proprietário **apenas no staging**; documentar essa limitação.
4. Confirmar destino vazio: tabelas comerciais e autenticação sem registros. Se não estiver vazio, parar; não truncar automaticamente nem fazer upsert que misture snapshots. Recriação/limpeza posterior requer escopo explícito de staging e aprovação.
5. Validar checksum, formato, allowlist e compatibilidade do pacote antes da carga. Iniciar uma única transação de carga no destino: importar `runs`, `products`, `orders`, `refunds`, `meta` com colunas explícitas, preservando IDs originais. Para `runs.id` GENERATED ALWAYS, usar mecanismo explícito de importação de identidade compatível com PostgreSQL, revisado no ensaio.
6. Ajustar o próximo valor da identidade de `runs` para acima do máximo importado com DDL transacional de identidade no destino. Não depender de `setval` revertível: alterações de sequência por `setval` não são desfeitas como os dados por ROLLBACK. Se essa estratégia mudar, documentar recuperação antes de executar.
7. Antes de COMMIT, comparar contagens, IDs, relacionamentos, anomalias preexistentes e controles financeiros com o manifesto. Verificar igualdade dos dados normalizados por chave/conteúdo, exceto sanitizações de metadados explicitamente autorizadas. Nenhum novo órfão ou divergência de centavo é aceito. Preservar `seen` e IDs de execução evita reclassificação indevida de pedidos ausentes.
8. Em falha, ROLLBACK da carga e manter staging fechado; não corrigir dados comerciais manualmente. Registrar diagnóstico agregado privado, sem valores de registros. Se commit ocorrer mas verificação externa falhar, bloquear acesso e decidir recomposição do destino, sem tocar a origem.
9. Após COMMIT, reabrir conexão para conferir persistência e checksums/controles. Comparar baseline MVP/E1 contra o mesmo conjunto isolado, sem substituir referência por resultados do próprio ranking. Manter tabelas de autenticação novas, sem importação de sessões.
10. Remover cópia temporária de transporte após aceite de integridade, conforme política de retenção aprovada. Só liberar o deploy após checklist e autorização G3.

Não transformar um relatório de sucesso de importação em homologação funcional. A homologação exige os testes de ranking, evolução, cestas, cobertura e interface do plano aprovado.

## 8. Barreiras contra acidente e limitações atuais

| Risco | Barreira antes de operar | Limitação / evidência exigida |
| --- | --- | --- |
| Startup/migração no banco errado | Credencial exclusiva do destino; processo separado; preflight não migratório com projeto/endpoint/schema aprovados e rejeição explícita da produção; revisão dupla | Host/usuário/nome de banco isoladamente não bastam. Guard ainda precisa de preparação e ensaio autorizados; não existe por configuração na E1 |
| Exportação gravável | SQL allowlisted, transação READ ONLY, TLS e papel leitor quando disponível | Papel owner em exceção ainda é privilegiado; não instalar no destino; sem autorizar mudança de RLS |
| Snapshot inconsistente | Uma conexão/transação para todos os SELECTs, manifesto do mesmo corte e carga atômica | Arquivos de horários distintos, CSVs manuais independentes ou cópia só dos pagos não são aceitos |
| Migração na origem | Nunca executar comandos da aplicação/exportador com Store na origem; exportador não importa módulo de startup | Migrations automáticas atuais permanecem; nome de schema novo não garante segurança |
| Sincronização INK | Token ausente do serviço, grupos, build/runtime e jobs; nenhuma execução de CLI sync; acesso à configuração restrito | `SyncService.start()` retorna antes de adquirir execução quando token ausente; endpoint autenticado pode retornar 503. Testar só em sintético/staging após autorização |
| Token inserido por engano | Revisão dupla de ambiente; proibição operacional e monitoramento de configuração; bloqueio de egress INK se recurso efetivamente disponível | Não há bloqueio hard de sync por modo staging na versão atual e não presumir firewall Free. Se controle preventivo independente for obrigatório, G3 fica bloqueado até adaptação técnica autorizada; não fingir que ausência do token resiste a alteração administrativa |
| Vazamento/autenticação cruzada | Login e host exclusivos, cookies seguros existentes, sem sessões de produção, nenhum segredo compartilhado | Confirmar comportamento em staging antes de acesso dos revisores; evidências reais privadas |
| Consumo prejudicar MVP | Projetos separados e orçamento de horas/egress/conexões; acompanhar cotas compartilhadas | Serviço separado não isola automaticamente franquia de workspace; pausar staging antes da reserva de produção |

Bloqueio obrigatório se houver: identidade de destino incerta, segredo de origem no serviço, token INK, vaga/cota não confirmada, RLS de leitura desconhecida, pacote sem corte consistente, código não aprovado ou ausência de autorização operacional. Não resolver bloqueios alterando produção.

## 9. Checklist pré-deploy — para G3, não executado

- [ ] Aprovação explícita de recursos nomeados, SHA, janela, método de exportação e cópia mínima; G1 confirmado e preparação de G2 aceita.
- [ ] Painéis conferidos; plano Free, saldo, espaço/margem e conexões documentados; custo máximo aprovado; sem auto upgrade.
- [ ] Projeto Supabase diferente do produtivo; preflight e ensaio de carga sintética aceitos; nenhuma credencial de produção disponível no ambiente gravável.
- [ ] Migrações/importação/identidade/reinício ensaiados apenas em destino sintético isolado; nenhuma modificação no schema de origem.
- [ ] Snapshot real autorizado com manifesto, mesmo corte e controles reconciliados; falhas/anomalias registradas; igualdade financeira exata.
- [ ] Novo serviço/configuração sem reutilizar nome/Blueprint/grupos de produção; branch exclusiva; auto deploy desligado; sem disco persistente ou cron. A criação de um Blueprint pode iniciar deploy: só aplicar após autorização G3.
- [ ] TLS verificado no pooler, `DATABASE_URL` exclusiva, schema explícito, pool pequeno; senha/hash fora de código/logs/frontend.
- [ ] Autenticação ligada, origem HTTPS correta, cookie seguro e login independente; rotas comerciais protegidas, healthcheck sem dados sensíveis.
- [ ] Token INK ausente em todas as fontes de ambiente; nenhum job de sync; política para impedimento de alteração acidental aceita ou hard-block previamente autorizado/implementado e testado.
- [ ] Testes/build/auditoria e testes de interface executados no ambiente sintético de teste, jamais em produção ou contra o snapshot real usando suíte destrutiva. Evidenciar resultados, não apenas comandos.
- [ ] Teste de persistência do destino e plano de retomada após suspensão; recursos de memória observados e limite de dois revisores inicial.
- [ ] Responsáveis e evidências privadas definidos; datas de retenção/encerramento aprovadas; checklist funcional do plano pronto para execução.

## 10. Encerramento do staging — execução futura autorizada

1. Ao concluir/reprovar, registrar resultado funcional, SHAs, corte, anomalias, pendências e limitações; não fazer merge, deploy produtivo ou E2 como consequência automática.
2. Parar acesso dos revisores e suspender/remover **somente serviço staging** pelo mecanismo disponível. Conferir nome/ID antes de agir; não editar configuração compartilhada de produção. Desligar qualquer gatilho de deploy de staging e acompanhar fim do consumo de quota.
3. Exportações temporárias: remover após verificação da carga. Snapshot de staging: retenção proposta de até 7 dias após decisão, com máximo de 30 dias desde carga. Extensão e eventual backup exigem aprovação. Evidências agregadas privadas seguem prazo definido pelo responsável.
4. Revogar credenciais exclusivas de staging e remover segredos/grupos exclusivos conforme autorização operacional. Nunca rotacionar senha/hash do MVP nem apagar grupo compartilhado. Se houver leitor de origem preexistente, não revogar uso de outros sistemas; leitor criado em autorização futura terá revogação própria revisada.
5. Remover projeto/schema de staging apenas após decisão de retenção e identificação positiva do projeto independente. Preferir encerrar o projeto dedicado quando aprovado; jamais executar DROP por uma URL reaproveitada ou apenas por nome de schema.
6. Verificar descarte do pacote privado, cópias temporárias e backups sob controle do operador. Exclusão no provedor pode seguir retenção residual própria: não prometer apagamento instantâneo de backups internos; registrar condições.
7. Confirmar por inspeção dos painéis que produção permanece no serviço/projeto/branch anteriores e que cotas não ficaram comprometidas. Não conectar ao banco produtivo para validar encerramento. Encerrar relatório com inventário dos recursos removidos/mantidos e razão de retenção.

## 11. Decisões pendentes para encerrar G1

| Pendência | Responsável / resposta esperada | Consequência se não resolvida |
| --- | --- | --- |
| Vaga Free e cotas nos dois provedores | Brazi: checklist dos painéis com números não secretos e data | Não provisionar |
| Tamanho e escopo do conjunto completo | Brazi/operador: relatório existente ou autorização futura de medição somente leitura | Capacidade Free não comprovada; não reduzir escopo silenciosamente |
| Leitor já disponível e políticas RLS | Operador: confirmação de acesso autorizado existente, sem compartilhar segredo | Escolher alternativa de exportação por operador ou manter dados reais bloqueados |
| Exceção de papel privilegiado no exportador | Brazi: aceitar/rejeitar explicitamente, se necessária | Não propor mudança de produção antes de avaliar alternativas |
| Controle de sync | Brazi/revisor: aceitar ausência de token + controles administrativos ou exigir hard-block futuro | Se hard-block obrigatório, preparar mudança em portão autorizado antes de G3 |
| SHA e preparação de ferramentas/guards | Revisor: versão E1 e autorização futura para ensaio de export/import e preflight | Procedimento ainda não é ferramenta executável validada |
| Janela, orçamento, revisores e retenção | Brazi: limite de horas, prazo e responsáveis | Não iniciar operações |

## 12. Evidência desta etapa

Revisão estática de modelos, schema/migrações, Store, sincronização e configuração Render; preparação exclusiva deste documento. Sem consulta aos painéis privados, banco real ou API INK. Nenhuma cópia, migração, permissão, credencial, recurso, deploy, código de produção ou E2 foi alterado. Nenhum item operacional foi marcado como executado. A publicação deste runbook na branch de desenvolvimento não autoriza G2/G3.
