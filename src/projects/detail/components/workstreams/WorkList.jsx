/**
 * WorkList stages section
 */
import React from 'react'
import PT from 'prop-types'
import { withRouter } from 'react-router-dom'

import WorkListHeader from './WorkListHeader'
import WorkListCard from './WorkListCard'
import LoadingIndicator from '../../../../components/LoadingIndicator/LoadingIndicator'
import {getActiveWorkFilter, getDeliveredWorkFilter} from '../../../../helpers/workstreams'
import './WorkList.scss'


class WorkList extends React.Component {
  constructor(props) {
    super(props)

    this.state = {
      listType: 'active'
    }
    this.getWorks = this.getWorks.bind(this)
  }

  componentWillMount() {
    const { workstream } = this.props
    // reupdate list type when reshow component
    if (workstream.listType) {
      this.setState({ listType: workstream.listType })
    }
  }

  /**
    * get works base on list type
    *
    * @return {Array} array of work
  */
  getWorks() {
    const {workstream} = this.props
    if (this.state.listType === 'active') {
      return _.filter(workstream.works, getActiveWorkFilter)
    } else if (this.state.listType === 'delivered') {
      return _.filter(workstream.works, getDeliveredWorkFilter)
    }
    return workstream.works
  }

  /**
   * show Input Review button when work has active "design-work" milestone
   *
   * @return {Boolean} show button or not
   */
  showInputReview(workId) {
    const { timelines } = this.props

    const timeline = _.find(timelines, { 'reference': 'work', 'referenceId': workId }) || {}
    const milestone = _.find(timeline.milestones, { 'type': 'design-work', 'status': 'active' }) || {}
    return !_.isEmpty(milestone)
  }

  render() {
    const {workstream, addWorkForWorkstream} = this.props
    const {listType} = this.state
    return (
      <div styleName="container">
        <WorkListHeader
          listType={listType}
          workstream={workstream}
          onChangeListType={(listType) => {
            this.setState({listType})
            workstream.listType = listType
          }}
        />
        {workstream.isLoadingWorks && (<LoadingIndicator />)}
        {!workstream.isLoadingWorks && (
          <div styleName="content">
            {this.getWorks().map((work) => (
              <WorkListCard key={`work-${work.id}`} work={work} workstream={workstream} showInputReviewBtn={this.showInputReview(work.id)} />
            ))}
          </div>
        )}
        {!workstream.isLoadingWorks && (
          <button
            styleName="add-work"
            className="tc-btn tc-btn-primary tc-btn-sm"
            onClick={() => addWorkForWorkstream(workstream.id)}
          >Add Work</button>
        )}
      </div>
    )
  }
}

WorkList.defaultProps = {
}

WorkList.propTypes = {
  workstream: PT.shape({
    works: PT.arrayOf(PT.shape({
      id: PT.number.isRequired,
      name: PT.string.isRequired,
      status: PT.string.isRequired,
      description: PT.string,
    })).isRequired,
    isLoadingWorks: PT.bool.isRequired,
  }).isRequired,
  addWorkForWorkstream: PT.func.isRequired,
  timelines: PT.array.isRequired
}

export default withRouter(WorkList)