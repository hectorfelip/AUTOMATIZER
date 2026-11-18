# Automation Studio — Especificação do Projeto

**Versão:** 1.0  
**Status:** Documento-base para desenvolvimento  
**Plataforma-alvo:** Windows 11 (Windows 10 com suporte aplicável, sujeito a testes)  
**Modelo de execução:** Local, em um único computador

## 1. Visão do produto

O Automation Studio é um aplicativo desktop para criação, edição, execução e monitoramento de automações no Windows. O usuário cria fluxos por meio de blocos visuais conectados, configura cada ação em painéis de propriedades e executa o fluxo localmente.

O produto deve reduzir a necessidade de programação manual, sem impedir a evolução técnica: a arquitetura deverá permitir adicionar novas ações, conectores e tipos de automação.

### 1.1 Objetivos

- Permitir criar automações visuais sem escrever código.
- Automatizar tarefas de mouse, teclado, janelas, arquivos, pastas, processos e navegador.
- Salvar, duplicar, importar e exportar fluxos.
- Executar fluxos com controle de estado, logs e tratamento de erros.
- Oferecer testes e depuração antes e durante a execução.
- Manter os dados localmente, sem exigir servidor ou conta online.

### 1.2 Fora do escopo inicial

- Gerenciamento centralizado de vários computadores.
- Execução em nuvem.
- Colaboração multiusuário em tempo real.
- Aplicativo mobile.
- Automação de dispositivos físicos externos.
- Agente remoto ou acesso remoto a máquinas.
- Execução invisível de ações em sessões Windows bloqueadas.
- Geração autônoma e irrestrita de scripts por IA.

## 2. Público e cenário de uso

**Perfil principal:** pessoa que utiliza Windows e deseja automatizar tarefas repetitivas no próprio computador.

**Exemplos de uso:**
- Organizar arquivos por extensão, nome ou data.
- Abrir aplicativos e preparar um ambiente de trabalho.
- Copiar arquivos para pastas de backup.
- Preencher formulários em aplicações compatíveis.
- Extrair dados de páginas web e salvar em CSV.
- Executar rotinas recorrentes.
- Monitorar pastas em busca de novos arquivos.

## 3. Princípios do produto

1. **Visual primeiro:** o fluxo deve ser compreensível no canvas.
2. **Execução previsível:** o motor deve executar uma representação validada do fluxo, não interpretar diretamente a interface.
3. **Segurança por padrão:** ações destrutivas exigem configuração e confirmação adequadas.
4. **Local-first:** projetos, configurações e histórico permanecem no computador.
5. **Extensibilidade:** novas ações podem ser adicionadas por meio de um registro de nós e contratos estáveis.
6. **Observabilidade:** toda execução deve produzir estado, logs e diagnóstico útil.
7. **Recuperação:** falhas devem ser identificáveis e, quando possível, permitir repetição controlada.

## 4. Escopo funcional

### 4.1 Dashboard

- Resumo de automações cadastradas.
- Execuções recentes e respectivos estados.
- Contagem de sucessos e falhas.
- Acesso rápido a automações favoritas.
- Ações para criar, importar e abrir automações.
- Indicador de disponibilidade do motor Python.

### 4.2 Gerenciamento de automações

Cada automação deverá possuir:
- ID único.
- Nome e descrição.
- Categoria e tags.
- Ícone ou cor identificadora.
- Versão do documento.
- Data de criação e atualização.
- Estado (ativa/arquivada).
- Definição do fluxo.
- Variáveis e parâmetros de entrada.
- Configurações de execução.

Ações disponíveis:
- Criar, abrir, renomear e excluir.
- Duplicar.
- Favoritar.
- Arquivar e restaurar.
- Importar e exportar.
- Consultar histórico de execução.

### 4.3 Editor visual

O editor deverá oferecer:
- Canvas com zoom e movimentação.
- Arrastar e soltar blocos da biblioteca.
- Conexões direcionais entre nós.
- Seleção múltipla, duplicação e exclusão.
- Copiar e colar.
- Desfazer e refazer.
- Comentários e agrupamento visual.
- Painel de propriedades do nó selecionado.
- Validação do fluxo.
- Indicadores de erro e aviso.
- Execução completa, a partir de um nó e passo a passo.
- Destaque do nó em execução.
- Atalhos de teclado.
- Salvamento manual e indicação de alterações não salvas.

### 4.4 Biblioteca inicial de ações

#### Gatilhos e controle
- Início manual.
- Aguardar duração.
- Se/Senão.
- Repetir N vezes.
- Enquanto.
- Para cada item.
- Parar fluxo.
- Executar subfluxo (fase posterior).
- Tratar erro (fase posterior).

#### Mouse e teclado
- Mover cursor.
- Clique esquerdo, direito e duplo.
- Pressionar e soltar tecla.
- Digitar texto.
- Atalho de teclado.
- Rolar.
- Aguardar após ação.

#### Janelas e aplicativos
- Abrir aplicativo.
- Encerrar processo.
- Localizar janela por título/processo.
- Ativar janela.
- Maximizar, minimizar e restaurar.
- Aguardar janela aparecer/desaparecer.
- Consultar se processo está em execução.

#### Arquivos e pastas
- Listar arquivos.
- Verificar existência.
- Criar pasta.
- Copiar, mover, renomear e excluir.
- Ler texto.
- Gravar texto.
- Obter metadados.
- Filtrar por extensão, nome ou data.

#### Dados
- Definir variável.
- Obter variável.
- Concatenar texto.
- Operações matemáticas.
- Comparar valores.
- Converter tipos.
- Trabalhar com listas.
- Ler e gravar CSV e JSON.

#### Navegador (fase posterior ao núcleo)
- Iniciar navegador gerenciado.
- Abrir URL.
- Localizar elemento por seletor acessível.
- Clicar e preencher campo.
- Ler texto e tabelas.
- Baixar arquivo.
- Aguardar navegação ou elemento.

### 4.5 Gravador de ações (fase posterior)

- Capturar cliques e teclas com consentimento explícito.
- Registrar intervalos entre ações.
- Permitir pausar e encerrar gravação.
- Converter gravação em nós editáveis.
- Permitir revisar e corrigir ações antes de salvar.
- Não capturar senhas ou campos sensíveis por padrão.
- Exibir aviso claro durante a gravação.

O gravador deve evitar depender exclusivamente de coordenadas absolutas. Sempre que possível, deverá associar ações a janelas, elementos acessíveis ou imagens de referência.

### 4.6 Execução e monitoramento

Estados mínimos:
- Aguardando.
- Validando.
- Em execução.
- Pausado.
- Concluído.
- Concluído com avisos.
- Falhou.
- Cancelado.

Recursos:
- Iniciar, pausar, continuar e cancelar.
- Exibir nó atual.
- Exibir duração e progresso quando mensurável.
- Receber logs estruturados.
- Registrar entrada e saída resumida de ações.
- Capturar diagnóstico em falhas, respeitando privacidade.
- Definir timeout global e por ação.
- Limitar tentativas de repetição.
- Interromper loops excessivos.

### 4.7 Histórico e logs

Cada execução deve registrar:
- Identificador da execução.
- Automação e versão executada.
- Horário de início e fim.
- Resultado final.
- Duração.
- Nó que falhou, quando aplicável.
- Mensagens de log.
- Erro técnico e mensagem amigável.
- Referência opcional a captura de tela de diagnóstico.

O usuário poderá filtrar por automação, período e estado, abrir detalhes e limpar histórico.

### 4.8 Agendador

A primeira versão poderá oferecer:
- Execução única em data/hora.
- Execução diária.
- Execução semanal.
- Inicialização junto ao login do usuário (opcional).

A integração deverá usar o Agendador de Tarefas do Windows ou mecanismo equivalente, com instruções claras sobre permissões e comportamento quando o usuário não estiver conectado. Não prometer execução de automações de interface em sessão bloqueada.

### 4.9 Importação e exportação

- Exportar automação em JSON versionado.
- Importar JSON validando esquema e versão.
- Mostrar resumo antes de importar.
- Rejeitar conteúdo inválido.
- Não executar automaticamente fluxos importados.
- Permitir exportar pacote com metadados e recursos necessários, sem segredos.

## 5. Requisitos não funcionais

### Desempenho
- Interface responsiva durante execução.
- Execução do motor em processo separado.
- Operações longas não podem bloquear o renderer.
- Logs devem ser enviados em lotes ou eventos sem travar a interface.

### Confiabilidade
- Validar fluxos antes da execução.
- Tratar falha de ação com mensagens úteis.
- Implementar timeout e cancelamento cooperativo.
- Recuperar estado visual após encerramento inesperado.
- Não afirmar que uma ação foi concluída sem confirmação do executor.

### Segurança e privacidade
- Não armazenar senhas em texto puro.
- Usar Windows Credential Manager para segredos quando necessário.
- Exigir confirmação para exclusões e ações potencialmente destrutivas.
- Restringir comandos arbitrários no MVP.
- Validar caminhos e parâmetros.
- Não executar fluxos importados automaticamente.
- Não registrar conteúdo sensível sem necessidade.
- Proteger comunicação entre processos e validar mensagens.

### Compatibilidade
- Prioridade: Windows 11 x64.
- Windows 10: compatibilidade a ser testada conforme edição e ciclo de suporte.
- Considerar diferentes escalas de DPI e resoluções.
- Documentar limitações de automação em aplicativos elevados (executados como administrador).

### Acessibilidade e usabilidade
- Atalhos de teclado.
- Contraste adequado.
- Estados não dependentes apenas de cor.
- Rótulos e descrições nos controles.
- Mensagens de erro acionáveis.

## 6. Critérios de aceite do MVP

O MVP será considerado funcional quando o usuário conseguir:

1. Instalar e abrir o aplicativo no Windows.
2. Criar uma automação vazia.
3. Adicionar e conectar nós no editor.
4. Configurar parâmetros e variáveis.
5. Salvar, fechar e reabrir o fluxo sem perda.
6. Validar o fluxo e receber erros compreensíveis.
7. Executar uma sequência com ações de arquivos, teclado/mouse e abertura de aplicativo.
8. Usar condição e repetição.
9. Pausar ou cancelar uma execução quando suportado pela ação em andamento.
10. Consultar histórico e logs.
11. Exportar e importar um fluxo.
12. Receber uma mensagem clara quando o motor estiver indisponível.

## 7. Entregáveis

- Aplicativo desktop instalável.
- Código-fonte organizado por módulos.
- Motor Python separado.
- Esquema versionado de automações.
- Biblioteca inicial de nós.
- Banco SQLite e migrações.
- Testes unitários e de integração.
- Documentação de instalação e uso.
- Exemplos de automações.
- Processo de build e empacotamento.

## 8. Indicadores de qualidade

- Percentual de execuções concluídas sem falha.
- Número de falhas por tipo de ação.
- Tempo médio para abrir o editor.
- Tempo de resposta da interface durante execução.
- Quantidade de fluxos inválidos detectados antes de executar.
- Facilidade de recuperação e diagnóstico de falhas.
