import _ from 'lodash'
import { unflatten } from 'flat'
import qs from 'query-string'
import React, { Component } from 'react'
import PropTypes from 'prop-types'
import { withRouter } from 'react-router-dom'
import { getProjectCreationTemplateField, getProjectTemplateByAlias, getProjectTemplatesByCategory, getProjectTypeByAlias } from '../../../helpers/templates'
import Wizard from '../../../components/Wizard'
import SelectProjectTemplate from './SelectProjectTemplate'
import SelectProjectType from './SelectProjectType'
import IncompleteProjectConfirmation from './IncompleteProjectConfirmation'
import FillProjectDetails from './FillProjectDetails'
import ProjectSubmitted from './ProjectSubmitted'

import update from 'react-addons-update'

import {
  LS_INCOMPLETE_PROJECT,
  LS_INCOMPLETE_WIZARD,
  LS_INCOMPLETE_PROJECT_QUERY_PARAMS,
  SPECIAL_QUERY_PARAMS,
  PROJECT_REF_CODE_MAX_LENGTH,
  PROJECT_ATTACHMENTS_FOLDER,
} from '../../../config/constants'
import {
  buildProjectUpdateQueryByQueryParamSelectCondition,
} from '../../../helpers/wizardHelper'
import './ProjectWizard.scss'

const WZ_STEP_INCOMP_PROJ_CONF = 0
const WZ_STEP_SELECT_PROJ_TYPE = 1
const WZ_STEP_SELECT_PROJ_TEMPLATE = 2
const WZ_STEP_FILL_PROJ_DETAILS = 3
const WZ_STEP_ERROR_CREATING_PROJ = 4
const WZ_STEP_PROJECT_SUBMITTED = 5

class ProjectWizard extends Component {

  constructor(props) {
    super(props)

    this.state = {
      wizardStep: WZ_STEP_SELECT_PROJ_TYPE,
      project: { details: {} },
      dirtyProject: { details: {} },
      isProjectDirty: false
    }

    this.updateProjectRef = this.updateProjectRef.bind(this)
    this.updateProjectTemplate = this.updateProjectTemplate.bind(this)
    this.updateProjectType = this.updateProjectType.bind(this)
    this.handleProjectChange = this.handleProjectChange.bind(this)
    this.loadIncompleteProject = this.loadIncompleteProject.bind(this)
    this.removeIncompleteProject = this.removeIncompleteProject.bind(this)
    this.handleOnCreateProject = this.handleOnCreateProject.bind(this)
    this.handleStepChange = this.handleStepChange.bind(this)
    this.restoreCommonDetails = this.restoreCommonDetails.bind(this)
    this.handleWizardCancel = this.handleWizardCancel.bind(this)
    this.loadProjectFromURL = this.loadProjectFromURL.bind(this)
  }

  componentDidMount() {
    const { onStepChange, projectTemplates, createdProject } = this.props
    const params = this.props.match.params

    // load incomplete project from local storage
    const incompleteProjectStr = window.localStorage.getItem(LS_INCOMPLETE_PROJECT)

    if ((params && params.project === 'submitted') || createdProject) {
      const wizardStep = WZ_STEP_PROJECT_SUBMITTED
      const updateQuery = {}
      this.setState({
        project: update(this.state.project, updateQuery),
        dirtyProject: update(this.state.dirtyProject, updateQuery),
        wizardStep,
        isProjectDirty: false
      }, () => {
        typeof onStepChange === 'function' && onStepChange(this.state.wizardStep, this.state.project)
      })
    } else if (incompleteProjectStr) {
      const incompleteProject = JSON.parse(incompleteProjectStr)
      const incompleteProjectTemplateId = _.get(incompleteProject, 'templateId')
      const incompleteProjectTemplate = _.find(projectTemplates, pt => pt.id === incompleteProjectTemplateId)
      let wizardStep = WZ_STEP_INCOMP_PROJ_CONF
      let updateQuery = {}
      if (incompleteProjectTemplate && params && params.project) {
        const projectTemplate = getProjectTemplateByAlias(projectTemplates, params.project)

        if (projectTemplate) {
          const incompleteProjectQueryParamsStr = window.localStorage.getItem(LS_INCOMPLETE_PROJECT_QUERY_PARAMS)
          const incompleteQueryParams = incompleteProjectQueryParamsStr ? JSON.parse(incompleteProjectQueryParamsStr) : {}
          const queryParams = qs.parse(window.location.search)
          // find out if the query params are different in the saved incomplete project and now
          // if query params are different, then we would treat such form as different and wouldn't continue editing,
          // we would propose user to start from scratch or continue with old query params
          const isQueryParamsChanged = !_.isEqual(
            _.omit(queryParams, SPECIAL_QUERY_PARAMS),
            _.omit(incompleteQueryParams, SPECIAL_QUERY_PARAMS)
          )

          // load incomplete project if the current URL is for the same Project Template
          // and query params which could be used to prefill project data are not changed
          if (projectTemplate.key === incompleteProjectTemplate.key && !isQueryParamsChanged) {
            console.info(`Creating project (restored from local storage) using Project Template (id: "${incompleteProjectTemplate.id}", key: "${incompleteProjectTemplate.key}", alias: "${incompleteProjectTemplate.aliases[0]}").`)
            wizardStep = WZ_STEP_FILL_PROJ_DETAILS
            updateQuery = {$merge : incompleteProject}
          } else {
            // explicitly ignores the wizardStep returned by the method
            // we need to call this method just to get updateQuery updated with correct project type
            this.loadProjectFromURL(params, updateQuery)
          }
        }
      }

      this.setState({
        project: update(this.state.project, updateQuery),
        dirtyProject: update(this.state.dirtyProject, updateQuery),
        wizardStep,
        isProjectDirty: false
      }, () => {
        typeof onStepChange === 'function' && onStepChange(this.state.wizardStep, this.state.project)
      })
    } else {
      // if there is no incomplete project in the local storage, load the wizard with appropriate step
      const updateQuery = {}
      let wizardStep = WZ_STEP_SELECT_PROJ_TYPE
      if (params && params.project) {
        wizardStep = this.loadProjectFromURL(params, updateQuery)
      }
      // retrieve refCode from query param
      // TODO give warning after truncating
      const refCode = _.get(qs.parse(window.location.search), 'refCode', '').trim().substr(0, PROJECT_REF_CODE_MAX_LENGTH)
      if (refCode.trim().length > 0) {
        // if refCode exists, update the updateQuery to set that refCode
        if (_.get(updateQuery, 'details')) {
          updateQuery['details']['utm'] = { $set : { code : refCode }}
        } else {
          updateQuery['details'] = { utm : { $set : { code : refCode }}}
        }
      }

      let projectState = this.state.project
      let dirtyProjectState = this.state.dirtyProject

      // get `templateId` from update query which has been updated above by calling `this.loadProjectFromURL`
      const templateId = _.get(updateQuery, 'templateId.$set')
      const projectTemplate = _.find(projectTemplates, { id: templateId })
      // during evaluation we do not use `SPECIAL_QUERY_PARAMS`, and we don't store them
      const queryParams = _.omit(qs.parse(window.location.search), SPECIAL_QUERY_PARAMS)
      // always store query params in local storage
      // if later they are changed for incomplete project we would know that probably user open another link and we have to reset project
      window.localStorage.setItem(LS_INCOMPLETE_PROJECT_QUERY_PARAMS, JSON.stringify(queryParams))
      if (projectTemplate) {
        console.info(`Creating project (from scratch) using Project Template (id: "${projectTemplate.id}", key: "${projectTemplate.key}", alias: "${projectTemplate.aliases[0]}").`)
        // if we already know project template, and there are some query params,
        // then pre-populate project data using `queryParamSelectCondition` from template
        if (!_.isEmpty(queryParams) && projectTemplate.scope) {
          // during evaluation we do use `SPECIAL_QUERY_PARAMS`
          const prefillProjectQuery = buildProjectUpdateQueryByQueryParamSelectCondition(projectTemplate.scope, _.omit(queryParams, SPECIAL_QUERY_PARAMS))
          projectState = update(projectState, prefillProjectQuery)
          dirtyProjectState = update(dirtyProjectState, prefillProjectQuery)
        }
      }

      this.setState({
        project: update(projectState, updateQuery),
        dirtyProject: update(dirtyProjectState, updateQuery),
        wizardStep,
        isProjectDirty: false
      }, () => {
        typeof onStepChange === 'function' && onStepChange(this.state.wizardStep)
      })
    }
  }

  componentWillReceiveProps(nextProps) {
    const { onStepChange, createdProject } = nextProps
    const params = nextProps.match.params
    const type = _.get(nextProps.project, 'type', null)
    const projectTemplateId = _.get(nextProps.project, 'templateId', null)
    // redirect user to project details form, if we already have type and project available
    let wizardStep = type && projectTemplateId ? WZ_STEP_FILL_PROJ_DETAILS : null
    const updateQuery = {}
    if (params && params.project) { // if there exists project path param
      wizardStep = this.loadProjectFromURL(params, updateQuery)
    } else { // if there is not project path param, it should be first step of the wizard
      updateQuery['type'] = { $set : null }
      updateQuery['details'] = { $set : {} }
      wizardStep = WZ_STEP_SELECT_PROJ_TYPE
    }
    if (createdProject) {
      wizardStep = WZ_STEP_PROJECT_SUBMITTED
    }
    // if wizard step deduced above and stored in state are not the same, update the state
    if (wizardStep && this.state.wizardStep !== wizardStep) {
      this.setState({
        project: update(this.state.project, updateQuery),
        dirtyProject: update(this.state.dirtyProject, updateQuery),
        wizardStep
      }, () => {
        typeof onStepChange === 'function' && onStepChange(this.state.wizardStep)
      })
    }
  }

  /**
   * Loads project type from the given URL parameter.
   *
   * @param {object} urlParams   URL parameters map
   * @param {object} updateQuery query object which would be updated according to parsed project type
   *
   * @return {number} step where wizard should move after parsing the URL param
   */
  loadProjectFromURL(urlParams, updateQuery) {
    const { projectTemplates, projectTypes } = this.props
    const urlAlias = urlParams && urlParams.project
    const statusParam  = urlParams && urlParams.status

    if ('incomplete' === statusParam) {
      return WZ_STEP_INCOMP_PROJ_CONF
    }

    if (!urlAlias) return

    const projectType = getProjectTypeByAlias(projectTypes, urlAlias)
    // first try the path param to be a final step
    if (projectType === 'submitted') {
      return WZ_STEP_PROJECT_SUBMITTED
    } if (projectType) {
      // try the path param to be a project type
      updateQuery['type'] = { $set : projectType.key }
      return WZ_STEP_SELECT_PROJ_TEMPLATE
    } else {
      // if it is not a project type, it should be a project template
      const projectTemplate = getProjectTemplateByAlias(projectTemplates, urlAlias)

      // if we have some project template key in the URL and we can find the project template
      // show details step
      if (projectTemplate) {
        updateQuery['type'] = { $set : projectTemplate.category }
        updateQuery['templateId'] = { $set : projectTemplate.id }
        updateQuery['details'] = {}

        const refCode = _.get(qs.parse(window.location.search), 'refCode', '').trim().substr(0, PROJECT_REF_CODE_MAX_LENGTH)
        if (refCode) {
          updateQuery.details.utm = { $set : { code : refCode } }
        }

        return WZ_STEP_FILL_PROJ_DETAILS
      }
    }
  }

  /**
   * Loads incomplete project from the local storage and populates the state from that project.
   * It also moves the wizard to the project details step if there exists an incomplete project.
   */
  loadIncompleteProject() {
    const { onStepChange, onProjectUpdate, projectTemplates } = this.props
    const incompleteProjectStr = window.localStorage.getItem(LS_INCOMPLETE_PROJECT)
    if(incompleteProjectStr) {
      const incompleteProject = JSON.parse(incompleteProjectStr)
      const templateId = _.get(incompleteProject, 'templateId')
      const projectTemplate = _.find(projectTemplates, { id: templateId })
      if (projectTemplate) {
        console.info(`Creating project (confirmed: restored from local storage) using Project Template (id: "${projectTemplate.id}", key: "${projectTemplate.key}", alias: "${projectTemplate.aliases[0]}").`)
      }

      this.setState({
        project: update(this.state.project, { $merge : incompleteProject }),
        dirtyProject: update(this.state.dirtyProject, { $merge : incompleteProject }),
        wizardStep: WZ_STEP_FILL_PROJ_DETAILS
      }, () => {
        typeof onProjectUpdate === 'function' && onProjectUpdate(this.state.dirtyProject, false)
        typeof onStepChange === 'function' && onStepChange(this.state.wizardStep, this.state.dirtyProject)
      })
    }
  }

  getRefCodeFromURL() {
    return _.get(qs.parse(window.location.search), 'refCode', '').trim().substr(0, PROJECT_REF_CODE_MAX_LENGTH)
  }

  /**
   * Removed incomplete project from the local storage and resets the state. Also, moves wizard to the first step.
   */
  removeIncompleteProject() {
    const { onStepChange, projectTemplates } = this.props
    // remove incomplete project from local storage
    window.localStorage.removeItem(LS_INCOMPLETE_PROJECT)
    window.localStorage.removeItem(LS_INCOMPLETE_WIZARD)
    // following code assumes that componentDidMount has already updated state with correct project
    const projectType = _.get(this.state.project, 'type')
    const projectTemplateId = _.get(this.state.project, 'templateId')
    let wizardStep = WZ_STEP_SELECT_PROJ_TYPE
    let project = null
    // during evaluation we do not use `SPECIAL_QUERY_PARAMS`, and we don't store them
    const queryParams = _.omit(qs.parse(window.location.search), SPECIAL_QUERY_PARAMS)
    // always store query params in local storage
    // if later they are changed for incomplete project we would know that probably user open another link and we have to reset project
    window.localStorage.setItem(LS_INCOMPLETE_PROJECT_QUERY_PARAMS, JSON.stringify(queryParams))
    if (projectTemplateId) {
      project = { type: projectType, templateId: projectTemplateId, details: {} }
      wizardStep = WZ_STEP_FILL_PROJ_DETAILS
      const projectTemplate = _.find(projectTemplates, { id: projectTemplateId })
      if (projectTemplate) {
        console.info(`Creating project (confirmed: from scratch) using Project Template (id: "${projectTemplate.id}", key: "${projectTemplate.key}", alias: "${projectTemplate.aliases[0]}").`)
        // if we already know project template, and there are some query params,
        // then pre-populate project data using `queryParamSelectCondition` from template
        if (!_.isEmpty(queryParams) && projectTemplate.scope) {
          const prefillProjectQuery = buildProjectUpdateQueryByQueryParamSelectCondition(projectTemplate.scope, queryParams)
          project = update(project, prefillProjectQuery)
        }
      }
    }
    const refCode = this.getRefCodeFromURL()
    if (refCode) {
      project.details.utm = { code : refCode}
    }
    this.setState({
      project: _.merge({}, project),
      dirtyProject: _.merge({}, project),
      wizardStep
    }, () => {
      typeof onStepChange === 'function' && onStepChange(this.state.wizardStep, this.state.project)
    })
  }

  updateProjectRef(projectRef) {
    const details = _.get(this.state.project, 'details.utm.code')
    let updateQuery = { details: { utm : { code : {$set : projectRef }}}}
    if (!details) {
      updateQuery = { details: { $set : { utm : { code : projectRef }}}}
    }
    this.setState({
      project: update(this.state.project, updateQuery),
      dirtyProject: update(this.state.project, updateQuery)
    })
  }

  updateProjectTemplate(projectTemplate) {

    const incompleteProjectStr = window.localStorage.getItem(LS_INCOMPLETE_PROJECT)
    const newProject = {}
    // if we started filling some form and now we are switching template
    // we are clearing all form data and wizard state, except for 3 for fields: name, description and ref code
    if (incompleteProjectStr) {
      const incompleteProject = JSON.parse(incompleteProjectStr)
      const incompleteProjectTemplateId = _.get(incompleteProject, 'templateId')

      if (projectTemplate.id !== incompleteProjectTemplateId) {
        window.localStorage.removeItem(LS_INCOMPLETE_PROJECT)
        window.localStorage.removeItem(LS_INCOMPLETE_WIZARD)

        // usually, we only save form data to localstorage when user changed at least something in the form
        // in case we are switching Project Template we are saving form data to localstorage anyway
        // without waiting for user to change anything, as we already keep some fields which we treat as changes
        if (projectTemplate) {
          const keepData = {}

          // keep some project fields
          _.set(keepData, 'name', _.get(incompleteProject, 'name'))
          _.set(keepData, 'description', _.get(incompleteProject, 'description'))
          _.set(keepData, 'details.utm.code', _.get(incompleteProject, 'details.utm.code'))

          // keep chosen project type and template id
          _.set(keepData, 'type', projectTemplate.category)
          _.set(keepData, 'templateId', projectTemplate.id)

          window.localStorage.setItem(LS_INCOMPLETE_PROJECT, JSON.stringify(keepData))
        }

        // keep some form fields values
        newProject.name = { $set:_.get(incompleteProject, 'name') }
        newProject.description = { $set:_.get(incompleteProject, 'description') }
        newProject.details = { $set: { utm: { code:_.get(incompleteProject, 'details.utm.code') } } }
      } else {
        const incompleteProject = JSON.parse(incompleteProjectStr)
        _.assign(newProject, incompleteProject)
      }
    }
    window.scrollTo(0, 0)
    const { onStepChange, onProjectUpdate } = this.props
    const updateQuery = {}
    if (projectTemplate) {
      updateQuery.type = { $set : projectTemplate.category }
      updateQuery.templateId = { $set: projectTemplate.id }
    }
    // merge project fields
    if(_.keys(newProject).length) {
      _.assign(updateQuery, newProject)
    }
    this.setState({
      project: update(this.state.project, updateQuery),
      dirtyProject: update(this.state.project, updateQuery),
      wizardStep: WZ_STEP_FILL_PROJ_DETAILS,
    }, () => {
      typeof onProjectUpdate === 'function' && onProjectUpdate(this.state.dirtyProject, false)
      typeof onStepChange === 'function' && onStepChange(this.state.wizardStep, this.state.dirtyProject)
    })
  }

  updateProjectType(projectType) {
    window.scrollTo(0, 0)
    const { onStepChange, onProjectUpdate, projectTemplates } = this.props
    const updateQuery = {}
    const visibleProjectTemplates = getProjectTemplatesByCategory(projectTemplates, projectType, true)

    if (projectType) {
      updateQuery.type = { $set : projectType }

      // sets the appropriate project template if project category has only one project template
      if (visibleProjectTemplates.length === 1) {
        updateQuery.templateId = { $set : visibleProjectTemplates[0].id }
      }
    }

    this.setState({
      project: update(this.state.project, updateQuery),
      dirtyProject: update(this.state.project, updateQuery),
      wizardStep: visibleProjectTemplates.length === 1 ? WZ_STEP_FILL_PROJ_DETAILS : WZ_STEP_SELECT_PROJ_TEMPLATE
    }, () => {
      typeof onProjectUpdate === 'function' && onProjectUpdate(this.state.dirtyProject, false)
      typeof onStepChange === 'function' && onStepChange(this.state.wizardStep, this.state.dirtyProject)
    })
  }

  /**
   * TODO this function currently doesn't make any effect
   *      this feature was lost
   *      keep it in the code as it could be used to fix this feature
   *
   * Restores common details of the project while changing project type.
   *
   * Added for Github issue#1037
   */
  restoreCommonDetails(projectTemplate, updateQuery, detailsQuery) {
    const name = _.get(this.state.dirtyProject, 'name')
    // if name was already entered, restore it
    if (name) {
      updateQuery.name = { $set: name }
    }
    const description = _.get(this.state.dirtyProject, 'description')
    // if description was already entered, restore it
    if (description) {
      updateQuery.description = { $set: description }
    }
    const utm = _.get(this.state.dirtyProject, 'details.utm')
    // if UTM code was already entered, restore it
    if (utm) {
      detailsQuery.utm = { code : utm.code }
    }
    const appDefinitionQuery = {}
    const goal = _.get(this.state.dirtyProject, 'details.appDefinition.goal')
    // finds the goal field from the updated project template
    const goalField = getProjectCreationTemplateField(
      projectTemplate,
      'appDefinition',
      'questions',
      'details.appDefinition.goal.value'
    )
    // if goal was already entered and updated project template has the field, restore it
    if (goalField && goal) {
      appDefinitionQuery.goal = goal
    }
    const users = _.get(this.state.dirtyProject, 'details.appDefinition.users')
    // finds the users field from the target project template
    const usersField = getProjectCreationTemplateField(
      projectTemplate,
      'appDefinition',
      'questions',
      'details.appDefinition.users.value'
    )
    // if users was already entered and updated project template has the field, restore it
    if (usersField && users) {
      appDefinitionQuery.users = users
    }
    const notes = _.get(this.state.dirtyProject, 'details.appDefinition.notes')
    // finds the notes field from the target project template
    const notesField = getProjectCreationTemplateField(
      projectTemplate,
      'appDefinition',
      'notes',
      'details.appDefinition.notes'
    )
    // if notes was already entered and updated project template has the field, restore it
    if (notesField && notes) {
      appDefinitionQuery.notes = notes
    }
    detailsQuery.appDefinition = appDefinitionQuery
  }

  handleProjectChange(change) {
    const { onProjectUpdate } = this.props
    this.setState({
      // update only dirtyProject when Form changes the model
      dirtyProject: _.mergeWith({}, this.state.dirtyProject, unflatten(change),
        // customizer to override array value with changed values
        (objValue, srcValue, key) => {// eslint-disable-line no-unused-vars
          if (_.isArray(srcValue)) {
            return srcValue// srcValue contains the changed values from action payload
          }
        }
      ),
      isProjectDirty: true
    }, () => {
      typeof onProjectUpdate === 'function' && onProjectUpdate(this.state.dirtyProject)
    })
  }

  handleOnCreateProject(model) {
    // add templateId and type to the saved project form
    _.set(model, 'templateId', _.get(this.state.dirtyProject, 'templateId'))
    _.set(model, 'type', _.get(this.state.dirtyProject, 'type'))
    this.props.createProject(model)
  }

  handleStepChange(wizardStep) {
    const { onStepChange, projectTemplates } = this.props
    const visibleProjectTemplates = getProjectTemplatesByCategory(projectTemplates, this.state.project.type, true)

    // if project type has only one project template, move one step back to select project type step
    if (wizardStep === WZ_STEP_SELECT_PROJ_TEMPLATE && visibleProjectTemplates.length === 1) {
      wizardStep = WZ_STEP_SELECT_PROJ_TYPE
    }

    // project type
    // if wizard has moved to select project template step,
    // it should persist project type, else it should be reset
    const type = wizardStep === WZ_STEP_SELECT_PROJ_TEMPLATE ? this.state.project.type : null
    this.setState({
      // resets project sub type or product
      project: update(this.state.project, { type: { $set : type }, details: {}}),
      dirtyProject: update(this.state.project, { type: { $set : type }, details: {}}),
      wizardStep
    }, () => {
      typeof onStepChange === 'function' && onStepChange(wizardStep, this.state.dirtyProject)
    })
  }

  handleWizardCancel() {
    this.props.closeModal()
  }

  render() {
    const { processing, showModal, userRoles, projectTemplates, projectTypes, projectId, match, templates } = this.props
    const { project, dirtyProject, wizardStep } = this.state
    const params = match.params
    const attachmentsStorePath = `${PROJECT_ATTACHMENTS_FOLDER}/new-project/`

    return (
      <Wizard
        showModal={showModal}
        className="ProjectWizard"
        onCancel={this.handleWizardCancel}
        onStepChange={ this.handleStepChange }
        step={wizardStep}
        shouldRenderBackButton={ (step) => step > 1 && step !== 5 }
      >
        <IncompleteProjectConfirmation
          loadIncompleteProject={ this.loadIncompleteProject }
          removeIncompleteProject={ this.removeIncompleteProject }
          userRoles={ userRoles }
        />
        <SelectProjectType
          onProjectTypeChange={ this.updateProjectType }
          projectTemplates={ projectTemplates }
          projectTypes={ projectTypes }
        />
        <SelectProjectTemplate
          onProjectTemplateChange={ this.updateProjectTemplate }
          projectTemplates={ projectTemplates }
          projectTypeKey={ project.type }
          projectTypes={ projectTypes }
        />
        <FillProjectDetails
          project={ project }
          templates={projectTemplates}
          projectTemplates={ projectTemplates }
          productTemplates={templates.productTemplates}
          productCategories={templates.productCategories}
          dirtyProject={ dirtyProject }
          processing={ processing}
          onCreateProject={ this.handleOnCreateProject }
          onChangeProjectType={() => this.handleStepChange(WZ_STEP_SELECT_PROJ_TYPE) }
          onProjectChange={ this.handleProjectChange }
          submitBtnText="Continue"
          userRoles={ userRoles }
          onBackClick={() => this.handleStepChange(wizardStep - 1)}
          addAttachment={this.props.addAttachment}
          updateAttachment={this.props.updateAttachment}
          removeAttachment={this.props.removeAttachment}
          attachmentsStorePath={attachmentsStorePath}
          canManageAttachments
        />
        <div />
        <ProjectSubmitted
          project={ project }
          projectTemplates={ projectTemplates }
          dirtyProject={ dirtyProject }
          params={ params }
          projectId={ projectId }
        />
      </Wizard>
    )
  }
}

ProjectWizard.propTypes = {
  /**
   * Callback to be called when the wizard is shown in modal form and close button is clicked.
   */
  closeModal: PropTypes.func,
  /**
   * Flag to render the wizard as modal (allows closing of the wizard at any step)
   */
  showModal: PropTypes.bool,
  /**
   * Callback to create project. Called when the wizard finishes its last step.
   */
  createProject: PropTypes.func.isRequired,
  /**
   * Callback called on every step change in the wizard.
   */
  onStepChange: PropTypes.func,
  /**
   * Callback called for every change in project details.
   */
  onProjectUpdate: PropTypes.func,
  /**
   * Flag which indicates that a project creation is in progress.
   */
  processing: PropTypes.bool.isRequired,
  /**
   * Roles of the logged in user. Used to determine anonymous access.
   */
  userRoles: PropTypes.arrayOf(PropTypes.string),
  /**
   * Project templates list.
   */
  projectTemplates: PropTypes.array.isRequired,
  /**
   * Project types list.
   */
  projectTypes: PropTypes.array.isRequired,
  /**
   * templates
   */
  templates: PropTypes.object.isRequired,
}

ProjectWizard.defaultProps = {
  closeModal: () => {},
  showModal: false
}

ProjectWizard.Steps = {
  WZ_STEP_INCOMP_PROJ_CONF,
  WZ_STEP_SELECT_PROJ_TYPE,
  WZ_STEP_SELECT_PROJ_TEMPLATE,
  WZ_STEP_FILL_PROJ_DETAILS,
  WZ_STEP_ERROR_CREATING_PROJ,
  WZ_STEP_PROJECT_SUBMITTED
}

export default withRouter(ProjectWizard)
