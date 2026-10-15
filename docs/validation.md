# Validação da primeira versão

Executada em 14/10/2026 no ambiente de desenvolvimento. O código e as instruções estão prontos para execução local; não houve implantação em servidor público.

## Automação

- `npm test`: 29 testes de integração, persistência, transporte e indicadores passaram.
- `npm run build`: backend, tipos da interface e compilação Vite concluídos.
- `npm run test:e2e`: 4 testes Chromium passaram (desktop, filtros, comparação, produtos, conciliação, estados vazios/erro, atualização manual e celular).
- `npm audit --audit-level=high`: nenhuma vulnerabilidade reportada no momento da verificação.

A automação de transporte testa HTTP 429 com Retry-After e renovação de timeout, tentativas limitadas e cancelamento, sem esperar os intervalos reais. As requisições reais desta validação não receberam 429. Os testes de navegador têm token desabilitado no servidor isolado e simulam os dados da interface.

## Validação com dados reais

A sincronização e a consistência foram verificadas em ambiente privado. Contagens, valores, resultados comerciais e arquivos da base real não fazem parte deste repositório.

A soma do ranking foi conferida com a receita de itens; os gráficos diário e mensal foram conferidos com o indicador confirmado. Um agregado SQL independente conferiu contagem e soma da base paga elegível. Valores e quantidades sem associação foram preservados.

A base SQLite permaneceu disponível após reiniciar o servidor. Os testes também verificaram UPSERT repetido, rollback e preservação de registros ausentes da origem. Foi verificada a ausência de campos pessoais de compradores nos dados normalizados persistidos.

## Interface e desempenho observados

Navegação real no Chromium sem erros JavaScript; filtros, produtos, paginação de 50 para 100 linhas, ordenação e conciliação exercitados. Layout de 390 px sem transbordamento horizontal do documento. Screenshots locais ficam em `.local/`, ignorados pelo Git.

Na consulta do histórico completo, observou-se aproximadamente 150–160 ms na primeira leitura e 6–8 ms em cache neste ambiente. Isso é uma observação, não uma garantia para outras máquinas ou bases maiores. A sincronização é sequencial e limitada deliberadamente pela pausa entre chamadas.

## Limites preservados

Não houve escrita na Reserva INK. Nenhuma credencial ou informação pessoal de comprador foi enviada ao navegador. O vínculo por IDs dentro de objetos opacos é opcional, baseado em evidência real e conferido no catálogo; detalhes estão em `integration-notes.md`.

Não há indicador de faturamento líquido definitivo. A base confirmada exclui integralmente pedidos atualmente reembolsados, inclusive parciais, e solicitações pendentes; não mede toda a receita historicamente recebida ou retida. O reconhecimento líquido definitivo exige conciliação dos casos pendentes e uma regra financeira por evento/período.

A moeda de apresentação não foi inferida. Configure `DISPLAY_CURRENCY` somente após confirmar moeda e unidade da origem. Datas comerciais seguem America/Sao_Paulo.

## Preparação para Render e autenticação

Validação adicional em 14/10/2026, sem deploy no Render:

- 39 testes de backend, configuração, Blueprint e indicadores passaram; 5 testes de navegador passaram, incluindo login/logout reais contra o servidor de teste.
- Build TypeScript/Vite e auditoria de dependências concluídos sem falha ou vulnerabilidade reportada.
- Artefato limpo produzido em diretório temporário com `npm ci --include=dev`, build e `npm prune --omit=dev`; Vite e tsx ausentes no runtime.
- Processo de produção escutou em PORT fornecida pelo teste, com bind de produção, redirecionamento HTTP para origem HTTPS fixa, bloqueio de API anônima e cookie Secure/HttpOnly/Strict.
- Banco de teste ficou fora da pasta da aplicação; após substituir a pasta da aplicação e reiniciar, os dados e a sessão de teste foram preservados.
- Gerador de hash foi exercitado em terminal interativo: entrada oculta, sem eco da senha e hash no formato esperado. Nenhum segredo de produção foi gerado ou armazenado.

Os testes de HTTPS simulam o ingresso TLS do Render por cabeçalhos de proxy em conexões locais. Certificado, provisionamento do disco e aceitação final do Blueprint no Render dependem de um futuro deploy autorizado. A documentação direta do Render retornou 403 na rede deste ambiente; valores atuais de planos não foram consultados. O guia de operação está em `render.md`.
