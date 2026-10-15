# Contrato e evidências de integração

A referência principal é `api-1.yaml` fornecida pelo usuário. Não foram criados endpoints da Reserva INK: usamos GET de `/v1/stores/orders`, `/v1/stores/products` e `/v1/stores/orders/{order_id}/refunds`.

O schema dos itens declara `product_v2` e `product_variant` como objetos sem propriedades. A implementação inicial usou os SKUs documentados, mas a carga real demonstrou que os SKUs dos itens não correspondem aos SKUs das variantes do catálogo nesta loja. Não se deve afirmar que ambos são a mesma chave.

Uma inspeção privada verificou que os objetos retornam uma propriedade `id` numérica e que há correspondências com o catálogo. Isso é **evidência de execução, não uma garantia adicional do OpenAPI**. Tamanhos de amostras e resultados comerciais não são publicados neste repositório.

O adaptador agora captura esses IDs opcionais, valida inteiro positivo e só associa a um produto conhecido. Uma variante também precisa apontar para um produto conhecido. Se os dois IDs discordarem, não há associação. Se o ID de produto retornado não existir no catálogo, não o substituímos por um SKU de outro produto. Na ausência dos IDs, o SKU pode ser usado apenas quando identifica um único produto. Os demais casos permanecem em um grupo explícito sem associação, preservando valores e quantidades.

Também foram observadas strings de montantes de reembolso com mais de duas casas decimais, inclusive precisão longa. Uma inspeção anterior que classificou genericamente tais strings como “formatação monetária/local” não provava o uso de separadores locais: a inspeção específica para o dashboard confirmou frações decimais adicionais. Os campos comuns dos pedidos tinham uma ou duas casas.

O backend calcula a base de pedidos em centavos inteiros. Para reembolsos, frações adicionais são arredondadas ao centavo com regra decimal meio para cima, sem Number/float intermediário. Se houver perda de fração não zero, o pedido recebe motivo de conciliação `refund_precision`. Zeros finais extras não mudam o montante. Valores não reconhecidos permanecem desconhecidos, nunca recebimentos/reembolsos financeiros de valor zero.

Valores de `payment_status` retornados em português são separados dos enums em inglês dos filtros. A classificação é explícita e conservadora. Estados desconhecidos não são interpretados como pagos. `approved` no histórico indica aprovação na API, não comprovação independente de liquidação.
